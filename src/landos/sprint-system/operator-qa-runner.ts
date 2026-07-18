// LandOS Sprint System — Automated Operator Acceptance Runner.
//
// Executes golden operator journeys against the REAL local dashboard:
// preflight (current production build, exactly one managed server, health,
// live frontend bundle), real browser navigation, visible-value assertions,
// API/frontend reconciliation, refresh persistence, managed restart
// persistence, screenshot capture, structured report output, and a nonzero
// exit on failure. Localhost only by default. The browser, fetch, and
// managed-runtime seams are injectable so tests never launch anything; the
// production wiring (puppeteer over the approved persistent Chrome CDP
// session) lives in qa-browser.ts. Reports always distinguish real browser
// execution from simulation. Dashboard tokens are never printed and never
// stored unredacted.

import fs from 'fs';
import path from 'path';
import { redactUrl } from './ledger.js';
import type { NewFinding } from './orchestrator.js';
import {
  GOLDEN_JOURNEYS,
  type CardCriteria,
  type GoldenJourney,
  type JourneyStep,
  getJourney,
  journeysForCapability,
  journeysForDepartment,
} from './journeys.js';

export const DEFAULT_BASE_URL = 'http://localhost:3141';
export const EVIDENCE_ROOT = path.join('.runtime', 'landos', 'qa');

// ─────────────────────────────────────────────────────────────────────────
// Injectable seams
// ─────────────────────────────────────────────────────────────────────────

export interface QaPageDriver {
  goto(url: string): Promise<void>;
  pageText(): Promise<string>;
  testIdCount(testId: string): Promise<number>;
  setViewport(width: number, height: number): Promise<void>;
  clickText(text: string): Promise<boolean>;
  clickTestId(testId: string): Promise<boolean>;
  fillTestId(testId: string, value: string): Promise<boolean>;
  uploadTestId(testId: string, filePath: string): Promise<boolean>;
  screenshot(filePath: string): Promise<void>;
  reload(): Promise<void>;
}

export interface QaBrowserSession {
  page: QaPageDriver;
  /** 'real' = an actual browser drove the localhost dashboard. */
  mode: 'real' | 'simulated';
  description: string;
  dispose(): Promise<void>;
}
export type QaBrowserFactory = () => Promise<QaBrowserSession>;

export interface ManagedRuntime {
  status(): Promise<{ ok: boolean; detail: string; pid: number | null }>;
  restart(): Promise<{ ok: boolean; detail: string }>;
}

export interface RunnerDeps {
  root: string;
  baseUrl?: string;
  /** Dashboard token supplier. The value is never logged or persisted. */
  token?: () => Promise<string>;
  fetchImpl?: typeof fetch;
  browserFactory?: QaBrowserFactory;
  managedRuntime?: ManagedRuntime;
  evidenceDir?: string;
  now?: () => Date;
  /** Mutating journeys are refused unless explicitly allowed. */
  allowMutations?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────
// Results
// ─────────────────────────────────────────────────────────────────────────

export interface PreflightCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface StepResult {
  index: number;
  kind: JourneyStep['kind'];
  description: string;
  status: 'pass' | 'fail' | 'skipped';
  detail: string;
  screenshotPath?: string;
}

export type JourneyOutcome =
  | 'pass'
  | 'fail'
  | 'fixture_unavailable'
  | 'mutation_refused'
  | 'manual_required'
  | 'error';

export interface JourneyRunResult {
  journeyId: string;
  name: string;
  outcome: JourneyOutcome;
  mode: 'real_browser' | 'simulated' | 'not_run';
  liveUrl: string;
  steps: StepResult[];
  screenshots: string[];
  findings: NewFinding[];
  startedAt: string;
  finishedAt: string;
}

export interface SuiteReport {
  runId: string;
  scope: string;
  baseUrl: string;
  startedAt: string;
  finishedAt: string;
  preflight: PreflightCheck[];
  preflightOk: boolean;
  journeys: JourneyRunResult[];
  summary: {
    pass: number;
    fail: number;
    fixtureUnavailable: number;
    mutationRefused: number;
    manualRequired: number;
    error: number;
  };
  exitCode: number;
  reportJsonPath?: string;
  reportMarkdownPath?: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Preflight
// ─────────────────────────────────────────────────────────────────────────

function newestMtime(dir: string, exts: string[]): number {
  let newest = 0;
  const walk = (d: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (exts.some((ext) => entry.name.endsWith(ext))) {
        const mtime = fs.statSync(full).mtimeMs;
        if (mtime > newest) newest = mtime;
      }
    }
  };
  walk(dir);
  return newest;
}

function assetNames(html: string): string[] {
  return [...html.matchAll(/\/assets\/[A-Za-z0-9._-]+\.(?:js|css)/g)].map((m) => m[0]).sort();
}

export async function runPreflight(deps: RunnerDeps): Promise<PreflightCheck[]> {
  const checks: PreflightCheck[] = [];
  const baseUrl = deps.baseUrl ?? DEFAULT_BASE_URL;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const serverEntry = path.join(deps.root, 'dist', 'index.js');
  const webIndex = path.join(deps.root, 'dist', 'web', 'index.html');
  const buildPresent = fs.existsSync(serverEntry) && fs.existsSync(webIndex);
  checks.push({
    name: 'production_build_present',
    ok: buildPresent,
    detail: buildPresent ? 'dist/index.js and dist/web/index.html exist' : 'production build missing; run npm run build',
  });
  if (buildPresent) {
    const newestSource = Math.max(
      newestMtime(path.join(deps.root, 'src'), ['.ts', '.tsx']),
      newestMtime(path.join(deps.root, 'web', 'src'), ['.ts', '.tsx', '.css']),
    );
    const newestDist = Math.max(
      newestMtime(path.join(deps.root, 'dist'), ['.js', '.html', '.css']),
      fs.statSync(serverEntry).mtimeMs,
    );
    const fresh = newestDist >= newestSource;
    checks.push({
      name: 'production_build_fresh',
      ok: fresh,
      detail: fresh
        ? 'dist output is newer than every source file'
        : 'source files are newer than the production build; rebuild before QA',
    });
  }
  const runtime = deps.managedRuntime ?? defaultManagedRuntime(deps.root);
  const status = await runtime.status();
  checks.push({
    name: 'managed_runtime_single_healthy',
    ok: status.ok,
    detail: status.detail,
  });
  try {
    const rootResponse = await fetchImpl(baseUrl, { signal: AbortSignal.timeout(5000) });
    checks.push({
      name: 'http_root',
      ok: rootResponse.status === 200,
      detail: `GET / -> ${rootResponse.status}`,
    });
    const servedHtml = rootResponse.status === 200 ? await rootResponse.text() : '';
    if (servedHtml && fs.existsSync(webIndex)) {
      const distAssets = assetNames(fs.readFileSync(webIndex, 'utf8'));
      const servedAssets = assetNames(servedHtml);
      const match = distAssets.length > 0 && JSON.stringify(distAssets) === JSON.stringify(servedAssets);
      checks.push({
        name: 'live_frontend_bundle_current',
        ok: match,
        detail: match
          ? `served bundle matches dist/web (${distAssets.length} assets)`
          : `served assets ${servedAssets.join(', ') || '(none)'} differ from dist/web ${distAssets.join(', ') || '(none)'} — stale frontend payload`,
      });
    }
  } catch (err) {
    checks.push({ name: 'http_root', ok: false, detail: `GET / failed: ${(err as Error).message}` });
  }
  try {
    const token = deps.token ? await deps.token() : '';
    const healthUrl = `${baseUrl}/api/health${token ? `?token=${encodeURIComponent(token)}` : ''}`;
    const health = await (deps.fetchImpl ?? fetch)(healthUrl, { signal: AbortSignal.timeout(5000) });
    checks.push({ name: 'health_api', ok: health.status === 200, detail: `GET /api/health -> ${health.status}` });
  } catch (err) {
    checks.push({ name: 'health_api', ok: false, detail: `health probe failed: ${(err as Error).message}` });
  }
  return checks;
}

/** Managed-runtime adapter: only the canonical runtime tool, never ad-hoc process control. */
export function defaultManagedRuntime(root: string): ManagedRuntime {
  const runtimeTool = path.join(root, 'scripts', 'runtime', 'landos-runtime.mjs');
  const run = async (command: string): Promise<{ code: number; out: string }> => {
    const { execFile } = await import('child_process');
    return new Promise((resolve) => {
      execFile(
        process.execPath,
        [runtimeTool, command],
        { cwd: root, encoding: 'utf8', timeout: 120_000 },
        (error, stdout, stderr) => {
          const code = error && typeof (error as { code?: unknown }).code === 'number'
            ? ((error as { code?: number }).code as number)
            : error
              ? 1
              : 0;
          resolve({ code, out: `${stdout}\n${stderr}`.trim() });
        },
      );
    });
  };
  return {
    async status() {
      const { code, out } = await run('status');
      const pid = Number(out.match(/^PID:\s*(\d+)/m)?.[1] ?? '');
      return {
        ok: code === 0,
        pid: Number.isInteger(pid) && pid > 0 ? pid : null,
        detail: code === 0
          ? `exactly one verified healthy LandOS server (PID ${pid})`
          : `landos:status exit ${code}: ${out.split('\n').slice(0, 3).join(' | ')}`,
      };
    },
    async restart() {
      const { code, out } = await run('restart');
      return {
        ok: code === 0,
        detail: code === 0 ? 'managed restart completed' : `landos:restart exit ${code}: ${out.split('\n').slice(-3).join(' | ')}`,
      };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Fixture selection (acceptance fixtures — read-only, heuristic, honest)
// ─────────────────────────────────────────────────────────────────────────

type Fetcher = (apiPath: string) => Promise<{ status: number; json: unknown; text: string }>;

function cardsFrom(json: unknown): Record<string, unknown>[] {
  if (Array.isArray(json)) return json as Record<string, unknown>[];
  if (json && typeof json === 'object') {
    for (const key of ['cards', 'dealCards', 'deal_cards', 'items', 'rows']) {
      const value = (json as Record<string, unknown>)[key];
      if (Array.isArray(value)) return value as Record<string, unknown>[];
    }
  }
  return [];
}

function cardId(card: Record<string, unknown>): number | null {
  const id = card.id ?? card.deal_card_id ?? card.dealCardId;
  return typeof id === 'number' ? id : null;
}

const CRITERIA_PATTERNS: Record<Exclude<CardCriteria, 'any'>, RegExp[]> = {
  verified_strong_evidence: [/verified/i, /evidence/i],
  verified_incomplete_research: [/verified/i, /(open|missing|pending|incomplete|needs)/i],
  unresolved: [/(unresolved|needs_review|needs review|unverified)/i],
  apn_conflict: [/apn/i, /(conflict|mismatch)/i],
  acreage_conflict: [/acre/i, /(conflict|mismatch)/i],
  strong_comps: [/comp/i],
  thin_comps: [/comp/i],
  quarantined_research: [/quarantin/i],
  investigative_path_plan: [/apn_variants/i, /county_recorder/i],
  provider_fallback: [/fallback/i],
  multi_parcel: [/parcel/i],
};

export async function selectFixtureCard(
  criteria: CardCriteria,
  fetcher: Fetcher,
): Promise<{ dealId: number; detail: string } | null> {
  const list = await fetcher('/api/landos/deal-cards');
  if (list.status !== 200) return null;
  const cards = cardsFrom(list.json);
  if (!cards.length) return null;
  if (criteria === 'any') {
    const id = cardId(cards[0]);
    return id === null ? null : { dealId: id, detail: 'first available deal card' };
  }
  const patterns = CRITERIA_PATTERNS[criteria];
  // The acreage/APN conflict state lives on /report (operatorRecord), not on the
  // base /deal-cards/:id payload, and can sit past the first handful of cards —
  // scan the full list and consult /report for these criteria so a real conflict
  // fixture (e.g. a small-parcel assessed-vs-mapped conflict) is actually found.
  const consultReport = criteria === 'acreage_conflict';
  for (const card of cards.slice(0, 50)) {
    const id = cardId(card);
    if (id === null) continue;
    // A GENUINE requested-vs-resolved APN conflict is a recorded hard-stop fact
    // (resolution snapshot identityConflict), never a fuzzy text match — words
    // like "mismatch" in an internal provider trace must not select a fixture
    // that has no real conflict.
    if (criteria === 'apn_conflict') {
      const resolution = await fetcher(`/api/landos/deal-cards/${id}/resolution`);
      const snapshot = (resolution.json as Record<string, unknown> | null)?.snapshot as
        | { identityConflict?: { requestedApn?: string; resolvedApn?: string } | null }
        | null
        | undefined;
      if (resolution.status === 200 && snapshot?.identityConflict) {
        return { dealId: id, detail: `genuine identity conflict (requested ${snapshot.identityConflict.requestedApn ?? '?'} vs resolved ${snapshot.identityConflict.resolvedApn ?? '?'})` };
      }
      continue;
    }
    if (criteria === 'quarantined_research') {
      const workspace = await fetcher(`/api/landos/lead-workspace/${id}`);
      const mission = (workspace.json as Record<string, unknown> | null)?.work as Record<string, unknown> | undefined;
      const envelope = mission?.mission as Record<string, unknown> | undefined;
      const research = envelope?.research as Record<string, unknown> | undefined;
      const quarantined = envelope?.quarantinedEvidence;
      if (workspace.status === 200
        && research?.status === 'quarantined'
        && Array.isArray(quarantined)
        && quarantined.length > 0) {
        return { dealId: id, detail: `${quarantined.length} quarantined evidence row(s) with a durable research mission` };
      }
      continue;
    }
    if (criteria === 'investigative_path_plan') {
      const workspace = await fetcher(`/api/landos/lead-workspace/${id}`);
      const work = (workspace.json as Record<string, unknown> | null)?.work as Record<string, unknown> | undefined;
      const envelope = work?.mission as Record<string, unknown> | undefined;
      const research = envelope?.research as Record<string, unknown> | undefined;
      const trace = Array.isArray(research?.toolTrace) ? research.toolTrace as Array<Record<string, unknown>> : [];
      const providers = new Set(trace.map((row) => String(row.provider ?? row.stage ?? '')));
      const required = ['apn_variants', 'landportal_browser', 'county_gis', 'county_assessor', 'county_recorder', 'web_search', 'zillow', 'redfin'];
      if (workspace.status === 200 && required.every((provider) => providers.has(provider))) {
        return { dealId: id, detail: 'durable multi-path investigative plan' };
      }
      continue;
    }
    const detail = await fetcher(`/api/landos/deal-cards/${id}`);
    if (detail.status !== 200) continue;
    let haystack = detail.text;
    if (consultReport) {
      const report = await fetcher(`/api/landos/deal-cards/${id}/report`);
      if (report.status === 200) {
        haystack += ` ${report.text}`;
        const orr = (report.json as Record<string, unknown>)?.operatorRecord as
          | { identity?: { acreageConflict?: boolean; acreageBasis?: { disputed?: boolean } } }
          | undefined;
        if (criteria === 'acreage_conflict' && (orr?.identity?.acreageConflict || orr?.identity?.acreageBasis?.disputed)) {
          return { dealId: id, detail: 'acreage basis disputed (operatorRecord)' };
        }
      }
    }
    if (criteria === 'strong_comps' || criteria === 'thin_comps') {
      const comps = await fetcher(`/api/landos/deal-cards/${id}/comps`);
      const count = cardsFrom(comps.json).length
        || (Array.isArray((comps.json as Record<string, unknown>)?.comps)
          ? ((comps.json as Record<string, unknown>).comps as unknown[]).length
          : 0);
      if (criteria === 'strong_comps' && count >= 4) return { dealId: id, detail: `${count} comps` };
      if (criteria === 'thin_comps' && count > 0 && count <= 2) return { dealId: id, detail: `${count} comps` };
      continue;
    }
    if (criteria === 'multi_parcel') {
      const parcels = (haystack.match(/parcel/gi) ?? []).length;
      if (parcels >= 3) return { dealId: id, detail: `${parcels} parcel mentions` };
      continue;
    }
    if (patterns.every((re) => re.test(haystack))) {
      return { dealId: id, detail: `matched ${criteria}` };
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// Journey execution
// ─────────────────────────────────────────────────────────────────────────

const PATTERN_BY_STEP: Partial<Record<JourneyStep['kind'], string>> = {
  expect_text: 'frontend-missing-value',
  forbid_text: 'frontend-misleading-language',
  expect_test_id: 'frontend-missing-value',
  forbid_test_id: 'frontend-legacy-leak',
  set_viewport: 'mobile-layout-failure',
  api_reconcile: 'frontend-backend-divergence',
  refresh_persistence: 'refresh-data-loss',
  restart_persistence: 'restart-data-loss',
  click_text: 'dead-control',
  click_test_id: 'dead-control',
  fill_test_id: 'dead-control',
  upload_text_test_id: 'dead-control',
  navigate: 'page-load-failure',
};

function jsonScalar(value: unknown, dotted?: string): unknown {
  if (!dotted) return value;
  let current: unknown = value;
  for (const part of dotted.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export async function runJourney(
  journey: GoldenJourney,
  deps: RunnerDeps,
  context: { runId: string },
): Promise<JourneyRunResult> {
  const now = deps.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const baseUrl = deps.baseUrl ?? DEFAULT_BASE_URL;
  const token = deps.token ? await deps.token() : '';
  const fetchImpl = deps.fetchImpl ?? fetch;
  const evidenceDir = path.join(
    deps.evidenceDir ?? path.join(deps.root, EVIDENCE_ROOT),
    context.runId,
    journey.id,
  );
  const steps: StepResult[] = [];
  const screenshots: string[] = [];
  const findings: NewFinding[] = [];
  const finish = (outcome: JourneyOutcome, mode: JourneyRunResult['mode']): JourneyRunResult => ({
    journeyId: journey.id,
    name: journey.name,
    outcome,
    mode,
    liveUrl: redactUrl(`${baseUrl}/landos`),
    steps,
    screenshots,
    findings,
    startedAt,
    finishedAt: now().toISOString(),
  });

  if (journey.mutating && !deps.allowMutations) {
    steps.push({
      index: 0,
      kind: 'manual',
      description: 'mutation guard',
      status: 'skipped',
      detail: 'journey would create or modify operator data; refused without explicit mutation approval',
    });
    return finish('mutation_refused', 'not_run');
  }
  if (journey.operatorSteps.some((s) => s.kind === 'manual')) {
    steps.push({
      index: 0,
      kind: 'manual',
      description: journey.operatorSteps.find((s) => s.kind === 'manual')!.description,
      status: 'skipped',
      detail: 'journey contains a manual operator step; it must run through the browser-QA agent, not automation',
    });
    return finish('manual_required', 'not_run');
  }

  const apiFetch: Fetcher = async (apiPath: string) => {
    const url = `${baseUrl}${apiPath}${apiPath.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(10_000) });
    const text = await response.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: response.status, json, text };
  };

  if (journey.mutating) {
    const profile = await apiFetch('/api/landos/storage-profile');
    const body = profile.json as { mode?: unknown; syntheticOnly?: unknown } | null;
    if (profile.status !== 200 || body?.mode !== 'qa' || body.syntheticOnly !== true) {
      steps.push({
        index: 0,
        kind: 'manual',
        description: 'isolated QA storage guard',
        status: 'skipped',
        detail: 'mutating operator QA is permitted only when the live runtime reports QA DATA and syntheticOnly=true',
      });
      return finish('mutation_refused', 'not_run');
    }
  }

  let dealId: number | null = null;
  let opportunityId: number | null = null;
  const substitute = (raw: string): string => raw
    .replace('{dealId}', dealId === null ? '' : String(dealId))
    .replace('{opportunityId}', opportunityId === null ? '' : String(opportunityId));

  if (!deps.browserFactory) {
    steps.push({
      index: 0,
      kind: 'navigate',
      description: 'browser availability',
      status: 'fail',
      detail: 'no browser session available; a real browser is required for operator QA',
    });
    return finish('error', 'not_run');
  }

  let session: QaBrowserSession;
  try {
    session = await deps.browserFactory();
  } catch (err) {
    steps.push({
      index: 0,
      kind: 'navigate',
      description: 'browser availability',
      status: 'fail',
      detail: `browser session failed: ${(err as Error).message}`,
    });
    return finish('error', 'not_run');
  }
  const mode: JourneyRunResult['mode'] = session.mode === 'real' ? 'real_browser' : 'simulated';

  const record = (step: JourneyStep, index: number, status: StepResult['status'], detail: string, screenshotPath?: string) => {
    steps.push({ index, kind: step.kind, description: step.description, status, detail: redactUrl(detail), ...(screenshotPath ? { screenshotPath } : {}) });
    if (status === 'fail') {
      findings.push({
        liveUrl: redactUrl(`${baseUrl}/landos${dealId === null ? '' : `?deal=${dealId}`}`),
        steps: steps.map((s) => s.description),
        expected: step.description,
        actual: detail,
        evidencePaths: screenshots.slice(-1),
        severity: step.kind === 'api_reconcile' || step.kind.endsWith('_persistence') ? 'blocker' : 'major',
        suspectedSubsystem: journey.capability,
        disposition: 'internally_fixable',
        patternKey: PATTERN_BY_STEP[step.kind] ?? 'operator-journey-failure',
      });
    }
  };

  try {
    fs.mkdirSync(evidenceDir, { recursive: true });
    const page = session.page;
    const gotoPath = async (rawPath: string) => {
      const target = substitute(rawPath);
      const joiner = target.includes('?') ? '&' : '?';
      await page.goto(`${baseUrl}${target}${joiner}token=${encodeURIComponent(token)}`);
    };
    let failed = false;
    for (const [index, step] of journey.operatorSteps.entries()) {
      try {
        switch (step.kind) {
          case 'select_card': {
            const selected = await selectFixtureCard(step.criteria, apiFetch);
            if (!selected) {
              record(step, index, 'skipped', `no safe fixture matches ${step.criteria}; journey honestly unavailable`);
              await session.dispose();
              return finish('fixture_unavailable', mode);
            }
            dealId = selected.dealId;
            const workspace = await apiFetch(`/api/landos/lead-workspace/${selected.dealId}`);
            const workspaceBody = workspace.json as { opportunity?: { id?: unknown } } | null;
            const linkedOpportunityId = Number(workspaceBody?.opportunity?.id);
            opportunityId = Number.isInteger(linkedOpportunityId) ? linkedOpportunityId : null;
            record(step, index, 'pass', `deal card ${selected.dealId} (${selected.detail})`);
            break;
          }
          case 'navigate': {
            await gotoPath(step.path);
            record(step, index, 'pass', `opened ${substitute(step.path)}`);
            break;
          }
          case 'expect_text': {
            const text = await page.pageText();
            const hit = step.anyOf.find((t) => text.includes(t));
            if (hit) record(step, index, 'pass', `found "${hit}"`);
            else {
              failed = true;
              record(step, index, 'fail', `none of [${step.anyOf.join(', ')}] visible on the live page`);
            }
            break;
          }
          case 'forbid_text': {
            const text = await page.pageText();
            const hit = step.anyOf.find((t) => text.includes(t));
            if (hit) {
              failed = true;
              record(step, index, 'fail', `prohibited text "${hit}" is visible to the operator`);
            } else record(step, index, 'pass', 'no prohibited text visible');
            break;
          }
          case 'expect_test_id': {
            // Async renders (e.g. a workspace fetching its read model after a
            // click) settle within a bounded poll; the expected count must
            // still match exactly — polling never weakens the assertion.
            const expected = step.count ?? 1;
            let count = await page.testIdCount(step.testId);
            for (let waited = 0; count !== expected && waited < 5_000; waited += 250) {
              await new Promise<void>((resolve) => setTimeout(resolve, 250));
              count = await page.testIdCount(step.testId);
            }
            if (count === expected) record(step, index, 'pass', `data-testid="${step.testId}" count is ${count}`);
            else {
              failed = true;
              record(step, index, 'fail', `data-testid="${step.testId}" count is ${count}; expected ${expected}`);
            }
            break;
          }
          case 'forbid_test_id': {
            const count = await page.testIdCount(step.testId);
            if (count === 0) record(step, index, 'pass', `data-testid="${step.testId}" is absent`);
            else {
              failed = true;
              record(step, index, 'fail', `prohibited data-testid="${step.testId}" is present ${count} time(s)`);
            }
            break;
          }
          case 'set_viewport': {
            await page.setViewport(step.width, step.height);
            record(step, index, 'pass', `viewport set to ${step.width}x${step.height}`);
            break;
          }
          case 'click_text': {
            // {dealId} substitutes so journeys can click the dynamically
            // selected fixture's own row (e.g. "#{dealId}" in a list).
            const clickTarget = substitute(step.text);
            const clicked = await page.clickText(clickTarget);
            if (clicked) record(step, index, 'pass', `clicked "${clickTarget}"`);
            else if (step.optional) record(step, index, 'skipped', `control "${clickTarget}" not present (optional)`);
            else {
              failed = true;
              record(step, index, 'fail', `control "${clickTarget}" missing or unclickable`);
            }
            break;
          }
          case 'click_test_id': {
            const clicked = await page.clickTestId(step.testId);
            if (clicked) record(step, index, 'pass', `clicked data-testid="${step.testId}"`);
            else if (step.optional) record(step, index, 'skipped', `data-testid="${step.testId}" not present (optional)`);
            else {
              failed = true;
              record(step, index, 'fail', `data-testid="${step.testId}" missing or unclickable`);
            }
            break;
          }
          case 'fill_test_id': {
            const filled = await page.fillTestId(step.testId, substitute(step.value));
            if (filled) record(step, index, 'pass', `filled data-testid="${step.testId}"`);
            else {
              failed = true;
              record(step, index, 'fail', `data-testid="${step.testId}" missing or not editable`);
            }
            break;
          }
          case 'upload_text_test_id': {
            const safeName = path.basename(step.fileName).replace(/[^a-zA-Z0-9._-]/g, '_');
            const inputDir = path.join(evidenceDir, 'inputs');
            fs.mkdirSync(inputDir, { recursive: true });
            const file = path.join(inputDir, safeName);
            fs.writeFileSync(file, substitute(step.content), 'utf8');
            const uploaded = await page.uploadTestId(step.testId, file);
            if (uploaded) record(step, index, 'pass', `uploaded runtime QA text fixture to data-testid="${step.testId}"`);
            else {
              failed = true;
              record(step, index, 'fail', `data-testid="${step.testId}" missing or not a file input`);
            }
            break;
          }
          case 'screenshot': {
            const file = path.join(evidenceDir, `${step.name}.png`);
            await page.screenshot(file);
            screenshots.push(file);
            record(step, index, 'pass', `captured ${step.name}.png`, file);
            break;
          }
          case 'api_reconcile': {
            const api = await apiFetch(substitute(step.apiPath));
            if (api.status !== 200) {
              failed = true;
              record(step, index, 'fail', `API ${substitute(step.apiPath)} -> HTTP ${api.status}`);
              break;
            }
            if (step.extract && step.expectOnPage) {
              const value = jsonScalar(api.json, step.extract);
              const scalar = value === null || value === undefined ? '' : String(value);
              const text = await page.pageText();
              if (!scalar) {
                failed = true;
                record(step, index, 'fail', `API field ${step.extract} is empty`);
              } else if (!text.includes(scalar)) {
                failed = true;
                record(step, index, 'fail', `backend value "${scalar}" is not visible on the live page (frontend/backend divergence)`);
              } else record(step, index, 'pass', `backend value "${scalar}" visible on page`);
            } else {
              record(step, index, 'pass', `API ${substitute(step.apiPath)} -> 200 with body`);
            }
            break;
          }
          case 'refresh_persistence': {
            const before = await page.pageText();
            await page.reload();
            const after = await page.pageText();
            const kept = step.expectAnyOf.find((t) => after.includes(t));
            const semanticCount = step.expectTestId ? await page.testIdCount(step.expectTestId) : 0;
            const persisted = Boolean(kept) || (step.expectTestId !== undefined && semanticCount > 0);
            if (!persisted) {
              failed = true;
              record(step, index, 'fail', `after refresh none of [${step.expectAnyOf.join(', ')}] or data-testid="${step.expectTestId ?? '(none)'}" remained visible`);
            } else if (before.length > 0 && after.length === 0) {
              failed = true;
              record(step, index, 'fail', 'page content disappeared after refresh');
            } else record(step, index, 'pass', kept ? `data persisted across refresh ("${kept}")` : `data persisted across refresh (data-testid="${step.expectTestId}")`);
            break;
          }
          case 'restart_persistence': {
            const runtime = deps.managedRuntime ?? defaultManagedRuntime(deps.root);
            const restart = await runtime.restart();
            if (!restart.ok) {
              failed = true;
              record(step, index, 'fail', `managed restart failed: ${restart.detail}`);
              break;
            }
            const healthy = await waitForHealth(baseUrl, fetchImpl, 60_000);
            if (!healthy) {
              failed = true;
              record(step, index, 'fail', 'server did not return healthy after managed restart');
              break;
            }
            await page.reload();
            let after = await page.pageText();
            let kept = step.expectAnyOf.find((t) => after.includes(t));
            let semanticCount = step.expectTestId ? await page.testIdCount(step.expectTestId) : 0;
            for (let waited = 0; !kept && semanticCount === 0 && waited < 5_000; waited += 250) {
              await new Promise<void>((resolve) => setTimeout(resolve, 250));
              after = await page.pageText();
              kept = step.expectAnyOf.find((t) => after.includes(t));
              semanticCount = step.expectTestId ? await page.testIdCount(step.expectTestId) : 0;
            }
            if (kept || semanticCount > 0) record(step, index, 'pass', kept ? `data persisted across managed restart ("${kept}")` : `data persisted across managed restart (data-testid="${step.expectTestId}")`);
            else {
              failed = true;
              record(step, index, 'fail', `after managed restart none of [${step.expectAnyOf.join(', ')}] or data-testid="${step.expectTestId ?? '(none)'}" remained visible`);
            }
            break;
          }
          case 'manual':
            record(step, index, 'skipped', 'manual step');
            break;
        }
      } catch (err) {
        failed = true;
        record(step, index, 'fail', `step error: ${(err as Error).message}`);
      }
    }
    await session.dispose();
    return finish(failed ? 'fail' : 'pass', mode);
  } catch (err) {
    await session.dispose().catch(() => undefined);
    steps.push({
      index: steps.length,
      kind: 'navigate',
      description: 'journey execution',
      status: 'fail',
      detail: redactUrl(`journey error: ${(err as Error).message}`),
    });
    return finish('error', mode);
  }
}

async function waitForHealth(baseUrl: string, fetchImpl: typeof fetch, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetchImpl(baseUrl, { signal: AbortSignal.timeout(3000) });
      if (response.status === 200) return true;
    } catch {
      // still restarting
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────
// Suite runner + structured report
// ─────────────────────────────────────────────────────────────────────────

export interface SuiteScope {
  journeyId?: string;
  capability?: string;
  department?: string;
  all?: boolean;
}

export function resolveScope(scope: SuiteScope): { label: string; journeys: GoldenJourney[] } {
  if (scope.journeyId) return { label: `journey:${scope.journeyId}`, journeys: [getJourney(scope.journeyId)] };
  if (scope.capability) return { label: `capability:${scope.capability}`, journeys: journeysForCapability(scope.capability) };
  if (scope.department) return { label: `department:${scope.department}`, journeys: journeysForDepartment(scope.department) };
  return { label: 'all', journeys: GOLDEN_JOURNEYS };
}

export async function runOperatorQa(scope: SuiteScope, deps: RunnerDeps): Promise<SuiteReport> {
  const now = deps.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const runId = `qa-${startedAt.replace(/[:.]/g, '-')}`;
  const { label, journeys } = resolveScope(scope);
  const baseUrl = deps.baseUrl ?? DEFAULT_BASE_URL;
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(baseUrl)) {
    throw new Error(`operator QA runs against localhost only by default; refusing base URL ${redactUrl(baseUrl)}`);
  }
  const preflight = await runPreflight(deps);
  const preflightOk = preflight.every((c) => c.ok);
  const results: JourneyRunResult[] = [];
  if (preflightOk) {
    for (const journey of journeys) {
      results.push(await runJourney(journey, deps, { runId }));
    }
  }
  const summary = {
    pass: results.filter((r) => r.outcome === 'pass').length,
    fail: results.filter((r) => r.outcome === 'fail').length,
    fixtureUnavailable: results.filter((r) => r.outcome === 'fixture_unavailable').length,
    mutationRefused: results.filter((r) => r.outcome === 'mutation_refused').length,
    manualRequired: results.filter((r) => r.outcome === 'manual_required').length,
    error: results.filter((r) => r.outcome === 'error').length,
  };
  const exitCode = !preflightOk || summary.fail > 0 || summary.error > 0
    ? 1
    : summary.fixtureUnavailable > 0 || summary.manualRequired > 0 || summary.mutationRefused > 0
      ? 3
      : 0;
  const report: SuiteReport = {
    runId,
    scope: label,
    baseUrl,
    startedAt,
    finishedAt: now().toISOString(),
    preflight,
    preflightOk,
    journeys: results,
    summary,
    exitCode,
  };
  const dir = path.join(deps.evidenceDir ?? path.join(deps.root, EVIDENCE_ROOT), runId);
  fs.mkdirSync(dir, { recursive: true });
  report.reportJsonPath = path.join(dir, 'report.json');
  report.reportMarkdownPath = path.join(dir, 'report.md');
  fs.writeFileSync(report.reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(report.reportMarkdownPath, renderSuiteReport(report), 'utf8');
  return report;
}

export function renderSuiteReport(report: SuiteReport): string {
  const lines = [
    `# Operator QA Report — ${report.scope}`,
    '',
    `- Run: ${report.runId}`,
    `- Base URL: ${report.baseUrl}`,
    `- Started: ${report.startedAt}`,
    `- Finished: ${report.finishedAt}`,
    `- Preflight: ${report.preflightOk ? 'PASS' : 'FAIL'}`,
    `- Exit code: ${report.exitCode}`,
    '',
    '## Preflight',
    ...report.preflight.map((c) => `- [${c.ok ? 'x' : ' '}] ${c.name}: ${c.detail}`),
    '',
  ];
  for (const journey of report.journeys) {
    lines.push(`## ${journey.journeyId} — ${journey.outcome.toUpperCase()} (${journey.mode})`, '');
    for (const step of journey.steps) {
      lines.push(`- [${step.status === 'pass' ? 'x' : step.status === 'skipped' ? '-' : ' '}] ${step.kind}: ${step.description} — ${step.detail}`);
    }
    if (journey.screenshots.length) {
      lines.push('', ...journey.screenshots.map((s) => `- screenshot: ${s}`));
    }
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}
