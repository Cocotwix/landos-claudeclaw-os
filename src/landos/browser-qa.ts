import fs from 'node:fs';
import path from 'node:path';

import {
  automationBrowserConfig,
  connectAutomationBrowser,
  launchAutomationBrowser,
  type AutomationBrowser,
  type AutomationBrowserConfig,
  type AutomationPage,
  type LaunchAutomationResult,
} from './automation-browser.js';

export type BrowserQaOutcome = 'PASS' | 'FAIL' | 'BLOCKED';
export type BrowserQaConnectionSource = 'existing-cdp' | 'managed-launch';

export interface BrowserQaIssue {
  kind: 'console' | 'page-error' | 'request-failed' | 'http-error';
  severity: 'error' | 'warning';
  message: string;
  url?: string;
  status?: number;
}

export interface BrowserQaStep {
  name: string;
  outcome: 'PASS' | 'FAIL';
  detail: string;
  screenshot?: string;
}

export interface BrowserQaReport {
  runId: string;
  scenario: string;
  route: string;
  outcome: BrowserQaOutcome;
  reason: string;
  startedAt: string;
  finishedAt: string;
  connectionSource: BrowserQaConnectionSource | null;
  browserPid: number | null;
  health: { ok: boolean; attempts: number; detail: string };
  steps: BrowserQaStep[];
  issues: BrowserQaIssue[];
  screenshots: string[];
  cleanup: { pageClosed: boolean; browserDisconnected: boolean; browserProcessPreserved: boolean };
  artifactDir: string;
  reportJsonPath?: string;
  reportMarkdownPath?: string;
}

interface ConsoleLike {
  type(): string;
  text(): string;
}

interface ErrorLike { message?: string; stack?: string }

interface RequestLike {
  url(): string;
  resourceType?(): string;
  failure?(): { errorText?: string } | null;
}

interface ResponseLike {
  url(): string;
  status(): number;
  request?(): RequestLike;
}

export interface BrowserQaPuppeteerPage extends AutomationPage {
  on(event: 'console', handler: (message: ConsoleLike) => void): BrowserQaPuppeteerPage;
  on(event: 'pageerror', handler: (error: ErrorLike) => void): BrowserQaPuppeteerPage;
  on(event: 'requestfailed', handler: (request: RequestLike) => void): BrowserQaPuppeteerPage;
  on(event: 'response', handler: (response: ResponseLike) => void): BrowserQaPuppeteerPage;
  url(): string;
  reload(opts?: unknown): Promise<unknown>;
  screenshot(opts: { path: string; fullPage?: boolean }): Promise<unknown>;
  waitForSelector(selector: string, opts?: { timeout?: number; visible?: boolean }): Promise<unknown>;
  click(selector: string): Promise<void>;
  bringToFront?(): Promise<void>;
  evaluateOnNewDocument?(fn: (...args: any[]) => unknown, ...args: any[]): Promise<unknown>;
  evaluate<T>(fn: string | ((...args: any[]) => T), ...args: any[]): Promise<T>;
}

export interface BrowserQaSession {
  page: BrowserQaPuppeteerPage;
  artifactDir: string;
  goto(route?: string): Promise<void>;
  hardRefresh(expectedPath?: string): Promise<void>;
  waitFor(selector: string, timeoutMs?: number): Promise<void>;
  click(selector: string): Promise<void>;
  text(selector?: string): Promise<string>;
  exists(selector: string): Promise<boolean>;
  count(selector: string): Promise<number>;
  check(name: string, ok: boolean, detail: string): void;
  step(name: string, work: () => Promise<string | void>): Promise<void>;
  screenshot(name: string, fullPage?: boolean): Promise<string>;
  delay(ms: number): Promise<void>;
}

export interface BrowserQaScenario {
  id: string;
  route: string;
  /** Downgrade a known, explicitly asserted provider setup response to evidence. */
  allowIssue?(issue: Readonly<BrowserQaIssue>): boolean;
  run(session: BrowserQaSession): Promise<void>;
}

export class BrowserQaBlocked extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrowserQaBlocked';
  }
}

interface BrowserQaDeps {
  config?: AutomationBrowserConfig;
  launch?: () => Promise<LaunchAutomationResult>;
  connect?: () => Promise<AutomationBrowser>;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

export interface RunBrowserQaOptions {
  root: string;
  baseUrl?: string;
  token?: string;
  evidenceRoot?: string;
  scenario: BrowserQaScenario;
  deps?: BrowserQaDeps;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function safeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'browser-qa';
}

function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return value.replace(/([?&](?:token|key|code)=)[^&\s]+/gi, '$1[redacted]');
  }
}

function localUrl(baseUrl: string, route: string, token: string, runId: string): string {
  const base = new URL(baseUrl);
  const url = new URL(route, base);
  if (url.origin !== base.origin) throw new Error(`Browser QA navigation must stay on ${base.origin}.`);
  url.searchParams.set('landosQaRun', runId);
  if (token) url.searchParams.set('token', token);
  return url.toString();
}

function isSameOrigin(url: string, baseUrl: string): boolean {
  try { return new URL(url).origin === new URL(baseUrl).origin; } catch { return false; }
}

function renderReport(report: BrowserQaReport): string {
  const lines = [
    `# Browser QA — ${report.scenario}`,
    '',
    `- Outcome: ${report.outcome}`,
    `- Reason: ${report.reason}`,
    `- Route: ${report.route}`,
    `- Connection: ${report.connectionSource ?? 'none'}`,
    `- Browser PID: ${report.browserPid ?? 'unknown'}`,
    `- Health: ${report.health.ok ? 'PASS' : 'FAIL'} (${report.health.detail})`,
    '',
    '## Steps',
    ...report.steps.map((step) => `- [${step.outcome === 'PASS' ? 'x' : ' '}] ${step.name}: ${step.detail}${step.screenshot ? ` (${step.screenshot})` : ''}`),
    '',
    '## Browser diagnostics',
    ...(report.issues.length
      ? report.issues.map((issue) => `- ${issue.severity.toUpperCase()} ${issue.kind}: ${issue.message}${issue.status ? ` (HTTP ${issue.status})` : ''}${issue.url ? ` — ${issue.url}` : ''}`)
      : ['- No console errors, page errors, failed requests, or relevant HTTP failures.']),
    '',
    '## Cleanup',
    `- QA page closed: ${report.cleanup.pageClosed}`,
    `- CDP client disconnected: ${report.cleanup.browserDisconnected}`,
    `- Managed browser process preserved: ${report.cleanup.browserProcessPreserved}`,
  ];
  return `${lines.join('\n')}\n`;
}

function writeReport(report: BrowserQaReport): void {
  fs.mkdirSync(report.artifactDir, { recursive: true });
  report.reportJsonPath = path.join(report.artifactDir, 'report.json');
  report.reportMarkdownPath = path.join(report.artifactDir, 'report.md');
  fs.writeFileSync(report.reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(report.reportMarkdownPath, renderReport(report), 'utf8');
}

export async function waitForLandosHealth(
  baseUrl: string,
  deps: { fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void>; maxAttempts?: number; token?: string } = {},
): Promise<{ ok: boolean; attempts: number; detail: string }> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;
  const maxAttempts = deps.maxAttempts ?? 40;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const healthUrl = new URL('/api/health', `${baseUrl.replace(/\/$/, '')}/`);
      if (deps.token) healthUrl.searchParams.set('token', deps.token);
      const response = await fetchImpl(healthUrl, { signal: AbortSignal.timeout(3000) });
      if (response.status === 200) return { ok: true, attempts: attempt, detail: `HTTP 200 after ${attempt} attempt(s)` };
    } catch { /* bounded retry */ }
    if (attempt < maxAttempts) await sleep(500);
  }
  return { ok: false, attempts: maxAttempts, detail: `No HTTP 200 from /api/health after ${maxAttempts} bounded attempts` };
}

export async function acquireBrowserForQa(
  deps: BrowserQaDeps = {},
): Promise<{ browser: AutomationBrowser; source: BrowserQaConnectionSource; pid: number | null }> {
  const config = deps.config ?? automationBrowserConfig();
  const launch = deps.launch ?? (() => launchAutomationBrowser({ config }));
  const result = await launch();
  if (result.error) throw new BrowserQaBlocked(result.error);
  try {
    const browser = await (deps.connect ?? (() => connectAutomationBrowser({ config })))();
    return { browser, source: result.reused ? 'existing-cdp' : 'managed-launch', pid: result.pid };
  } catch (error) {
    throw new BrowserQaBlocked(`The owned Chrome endpoint ${config.endpoint} was ${result.reused ? 'discovered' : 'launched'} but Puppeteer could not control it: ${(error as Error).message}`);
  }
}

export async function runBrowserQa(options: RunBrowserQaOptions): Promise<BrowserQaReport> {
  const deps = options.deps ?? {};
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? defaultSleep;
  const started = now();
  const runId = `browser-${safeName(options.scenario.id)}-${started.toISOString().replace(/[:.]/g, '-')}`;
  const baseUrl = (options.baseUrl ?? 'http://localhost:3141').replace(/\/$/, '');
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(baseUrl)) {
    throw new Error(`Browser QA is localhost-only; refusing ${redactUrl(baseUrl)}.`);
  }
  const artifactDir = path.resolve(options.evidenceRoot ?? path.join(options.root, '.runtime', 'landos', 'qa'), runId);
  const report: BrowserQaReport = {
    runId,
    scenario: options.scenario.id,
    route: options.scenario.route,
    outcome: 'FAIL',
    reason: 'Browser QA did not finish.',
    startedAt: started.toISOString(),
    finishedAt: started.toISOString(),
    connectionSource: null,
    browserPid: null,
    health: { ok: false, attempts: 0, detail: 'not checked' },
    steps: [], issues: [], screenshots: [],
    cleanup: { pageClosed: false, browserDisconnected: false, browserProcessPreserved: true },
    artifactDir,
  };
  fs.mkdirSync(artifactDir, { recursive: true });

  let browser: AutomationBrowser | null = null;
  let page: BrowserQaPuppeteerPage | null = null;
  try {
    report.health = await waitForLandosHealth(baseUrl, { fetchImpl: deps.fetchImpl, sleep, token: options.token });
    if (!report.health.ok) throw new Error(`${report.health.detail}. Start or restart LandOS with the canonical runtime command.`);

    const acquired = await acquireBrowserForQa(deps);
    browser = acquired.browser;
    report.connectionSource = acquired.source;
    report.browserPid = acquired.pid;
    page = await browser.newPage() as BrowserQaPuppeteerPage;
    await page.setViewport?.({ width: 1600, height: 1000 });
    await page.bringToFront?.();

    const recordIssue = (issue: BrowserQaIssue): void => {
      if (issue.severity === 'error' && options.scenario.allowIssue?.(issue)) {
        report.issues.push({ ...issue, severity: 'warning', message: `Expected setup-state response: ${issue.message}` });
        return;
      }
      report.issues.push(issue);
    };
    page.on('console', (message) => {
      const type = message.type();
      if (type !== 'error' && type !== 'warning') return;
      const text = message.text();
      // Chromium also emits an un-attributed console error for every failed
      // resource. The response/request listeners below retain the actionable
      // URL and status and decide whether it is fatal; keep this duplicate as
      // warning evidence instead of counting the same failure twice.
      const resourceDuplicate = /^Failed to load resource:/i.test(text);
      recordIssue({ kind: 'console', severity: type === 'error' && !resourceDuplicate ? 'error' : 'warning', message: text });
    });
    page.on('pageerror', (error) => recordIssue({ kind: 'page-error', severity: 'error', message: error.message ?? String(error) }));
    page.on('requestfailed', (request) => {
      const url = request.url();
      const resource = request.resourceType?.() ?? 'unknown';
      const message = request.failure?.()?.errorText ?? `Failed ${resource} request`;
      recordIssue({
        kind: 'request-failed',
        // ERR_ABORTED is a browser cancellation during route changes, reloads
        // or page cleanup, not an unreachable endpoint. It remains recorded.
        severity: message === 'net::ERR_ABORTED'
          ? 'warning'
          : (isSameOrigin(url, baseUrl) || ['document', 'script', 'xhr', 'fetch'].includes(resource) ? 'error' : 'warning'),
        message,
        url: redactUrl(url),
      });
    });
    page.on('response', (response) => {
      const status = response.status();
      if (status < 400) return;
      const url = response.url();
      recordIssue({
        kind: 'http-error',
        severity: isSameOrigin(url, baseUrl) ? 'error' : 'warning',
        message: `HTTP ${status}`,
        url: redactUrl(url), status,
      });
    });

    const qaPage = page;
    const session: BrowserQaSession = {
      page: qaPage,
      artifactDir,
      async goto(route = options.scenario.route) {
        // Polling dashboards may never reach Puppeteer's network-idle
        // heuristic. DOM readiness plus scenario-specific visible assertions
        // is both bounded and tied to the operator outcome being tested.
        await qaPage.goto(localUrl(baseUrl, route, options.token ?? '', runId), { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await sleep(500);
      },
      async hardRefresh(expectedPath = options.scenario.route) {
        await qaPage.reload({ waitUntil: 'domcontentloaded', timeout: 45_000 });
        await sleep(800);
        const pathName = await qaPage.evaluate<string>(() => (globalThis as any).location.pathname);
        const ok = pathName === expectedPath;
        report.steps.push({ name: 'hard refresh route persistence', outcome: ok ? 'PASS' : 'FAIL', detail: `expected ${expectedPath}; found ${pathName}` });
      },
      async waitFor(selector, timeoutMs = 15_000) { await qaPage.waitForSelector(selector, { timeout: timeoutMs, visible: true }); },
      async click(selector) { await qaPage.click(selector); await sleep(300); },
      async text(selector = 'body') {
        return qaPage.evaluate<string>((sel: string) => ((globalThis as any).document.querySelector(sel)?.textContent ?? ''), selector);
      },
      async exists(selector) { return qaPage.evaluate<boolean>((sel: string) => Boolean((globalThis as any).document.querySelector(sel)), selector); },
      async count(selector) { return qaPage.evaluate<number>((sel: string) => (globalThis as any).document.querySelectorAll(sel).length, selector); },
      check(name, ok, detail) { report.steps.push({ name, outcome: ok ? 'PASS' : 'FAIL', detail }); },
      async step(name, work) {
        try {
          const detail = await work();
          report.steps.push({ name, outcome: 'PASS', detail: detail || 'completed' });
        } catch (error) {
          report.steps.push({ name, outcome: 'FAIL', detail: (error as Error).message });
        }
      },
      async screenshot(name, fullPage = false) {
        const file = path.join(artifactDir, `${safeName(name)}.png`);
        await qaPage.screenshot({ path: file, fullPage });
        report.screenshots.push(file);
        report.steps.push({ name: `screenshot: ${name}`, outcome: 'PASS', detail: 'fresh live browser capture', screenshot: file });
        return file;
      },
      async delay(ms) {
        if (!Number.isFinite(ms) || ms < 0 || ms > 15_000) throw new Error('Browser QA delay must be between 0 and 15000ms.');
        await sleep(ms);
      },
    };

    await options.scenario.run(session);
    const stepFailures = report.steps.filter((step) => step.outcome === 'FAIL');
    const diagnosticErrors = report.issues.filter((issue) => issue.severity === 'error');
    report.outcome = stepFailures.length || diagnosticErrors.length ? 'FAIL' : 'PASS';
    report.reason = report.outcome === 'PASS'
      ? `All ${report.steps.length} live assertions/captures passed with no relevant browser errors.`
      : `${stepFailures.length} step failure(s), ${diagnosticErrors.length} relevant browser diagnostic error(s).`;
  } catch (error) {
    report.outcome = error instanceof BrowserQaBlocked ? 'BLOCKED' : 'FAIL';
    report.reason = (error as Error).message;
  } finally {
    if (page) {
      try { await page.close({ runBeforeUnload: false }); report.cleanup.pageClosed = true; } catch { /* report false */ }
    }
    if (browser) {
      try { await browser.disconnect?.(); report.cleanup.browserDisconnected = true; } catch { /* report false */ }
    }
    report.finishedAt = now().toISOString();
    writeReport(report);
  }
  return report;
}
