// LandOS Sprint System — Real-browser wiring for operator QA.
//
// Reuses the APPROVED persistent browser infrastructure: puppeteer-core
// connected over CDP to the operator's dedicated LandOS Chrome profile
// (browser-session.ts conventions — Google Chrome only, never Edge, never a
// paid browser-testing service). If no Chrome is answering on the CDP port,
// it launches the dedicated profile headed so the operator can watch the
// journey. QA drives its OWN new tab and closes only that tab on dispose;
// it never closes operator tabs and never touches cookies or credentials.

import { spawn as nodeSpawn } from 'child_process';
import {
  CHROME_CANDIDATE_PATHS,
  readSessionConfig,
  resolveChromePath,
  verifyChromeCdpEndpoint,
  type BrowserSessionConfig,
} from '../browser-session.js';
import type { QaBrowserFactory, QaBrowserSession, QaPageDriver } from './operator-qa-runner.js';

/** Marker appended to every QA-navigated localhost URL so stale tabs from a
 * crashed/killed QA run are provably QA-owned and safe to close on the next
 * run. Operator tabs never carry it. */
export const QA_TAB_MARKER = 'landosQa=1';

// Runs inside the browser page, not Node.
declare const document: any;
declare const location: any;

interface PuppeteerPage {
  goto(url: string, opts?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  evaluate<T>(fn: (() => T) | ((arg: string) => T) | string, ...args: unknown[]): Promise<T>;
  screenshot(opts: { path: string; fullPage?: boolean }): Promise<unknown>;
  reload?(opts?: { waitUntil?: string }): Promise<unknown>;
  setViewport?(viewport: { width: number; height: number; deviceScaleFactor?: number; isMobile?: boolean }): Promise<void>;
  close(): Promise<void>;
  url(): string;
  $(selector: string): Promise<{
    evaluate<T>(fn: (node: any) => T): Promise<T>;
    uploadFile(...paths: string[]): Promise<void>;
  } | null>;
}
interface PuppeteerBrowser {
  newPage(): Promise<PuppeteerPage>;
  pages?(): Promise<PuppeteerPage[]>;
  disconnect(): Promise<void>;
  version(): Promise<string>;
}

/** Connect ONLY after the endpoint's /json/version proves it is genuine Google
 * Chrome — never Edge or an embedded third-party runtime squatting the port. */
async function connectCdp(cdpUrl: string): Promise<PuppeteerBrowser | null> {
  const identity = await verifyChromeCdpEndpoint(cdpUrl);
  if (!identity.ok) return null;
  try {
    const mod = (await import('puppeteer-core')) as unknown as {
      connect?: (opts: { browserURL: string; protocolTimeout?: number; defaultViewport?: null }) => Promise<PuppeteerBrowser>;
      default?: { connect: (opts: { browserURL: string; protocolTimeout?: number; defaultViewport?: null }) => Promise<PuppeteerBrowser> };
    };
    const connect = mod.connect ?? mod.default?.connect;
    if (!connect) return null;
    const browser = await connect({ browserURL: cdpUrl, protocolTimeout: 60_000, defaultViewport: null });
    await browser.version();
    return browser;
  } catch {
    return null;
  }
}

const withPort = (cdpUrl: string, port: string): string => cdpUrl.replace(/:\d+/, `:${port}`);

/** Candidate CDP endpoints: the configured port first, then fallbacks so a
 * foreign runtime squatting the default port never blocks (or receives) QA. */
function candidateCdpUrls(config: BrowserSessionConfig): string[] {
  const configured = config.cdpUrl;
  const port = configured.match(/:(\d+)/)?.[1] ?? '9222';
  const fallbacks = ['9223', '9224', '9225'].filter((candidate) => candidate !== port);
  return [configured, ...fallbacks.map((candidate) => withPort(configured, candidate))];
}

/** Close stale tabs left by a previously crashed/killed QA run. Only pages
 * whose URL carries the QA marker are ever touched — never operator tabs. */
async function closeStaleQaTabs(browser: PuppeteerBrowser): Promise<number> {
  if (!browser.pages) return 0;
  let closed = 0;
  try {
    for (const page of await browser.pages()) {
      try {
        if (page.url().includes(QA_TAB_MARKER)) {
          await page.close();
          closed += 1;
        }
      } catch {
        // page already gone
      }
    }
  } catch {
    // pages() unsupported on this connection
  }
  return closed;
}

function launchChrome(config: BrowserSessionConfig, cdpUrl: string): string | null {
  const chrome = resolveChromePath(config.chromePath);
  if (!chrome.path) return `Google Chrome not found. Checked: ${[config.chromePath, ...CHROME_CANDIDATE_PATHS].filter(Boolean).join('; ')}`;
  const port = cdpUrl.match(/:(\d+)/)?.[1] ?? '9222';
  const child = nodeSpawn(
    chrome.path,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${config.profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      'about:blank',
    ],
    { detached: true, stdio: 'ignore' },
  );
  child.unref();
  return null;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function wrapPage(page: PuppeteerPage): QaPageDriver {
  return {
    async goto(url: string) {
      // Localhost QA navigations carry the QA tab marker so a tab orphaned by
      // a killed run is identifiable — and closable — on the next run.
      const marked = /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(url) && !url.includes(QA_TAB_MARKER)
        ? `${url}${url.includes('?') ? '&' : '?'}${QA_TAB_MARKER}`
        : url;
      await page.goto(marked, { waitUntil: 'networkidle2', timeout: 45_000 });
      await sleep(500);
    },
    async pageText() {
      return page.evaluate<string>(() => (document.body ? (document.body.innerText as string) : ''));
    },
    async testIdCount(testId: string) {
      return page.evaluate<number>(
        ((id: string) => document.querySelectorAll(`[data-testid="${id}"]`).length) as unknown as (arg: string) => number,
        testId,
      );
    },
    async setViewport(width: number, height: number) {
      if (!page.setViewport) throw new Error('browser page does not support viewport changes');
      await page.setViewport({ width, height, deviceScaleFactor: 1, isMobile: width <= 480 });
      await sleep(300);
    },
    async clickText(text: string) {
      return page.evaluate<boolean>(
        ((needle: string) => {
          const nodes = Array.from(
            document.querySelectorAll('button, a, [role="button"], [role="tab"], summary, th, td, li'),
          ) as any[];
          const target = nodes.find((n) => ((n.innerText || '') as string).trim().includes(needle));
          if (!target) return false;
          target.click();
          return true;
        }) as unknown as (arg: string) => boolean,
        text,
      );
    },
    async clickTestId(testId: string) {
      return page.evaluate<boolean>(
        ((id: string) => {
          const target = document.querySelector(`[data-testid="${id}"]`) as any;
          if (!target || typeof target.click !== 'function') return false;
          target.click();
          return true;
        }) as unknown as (arg: string) => boolean,
        testId,
      );
    },
    async fillTestId(testId: string, value: string) {
      return page.evaluate<boolean>(
        (((encoded: string) => {
          const [id, nextValue] = JSON.parse(encoded) as [string, string];
          const target = document.querySelector(`[data-testid="${id}"]`) as any;
          if (!target || !('value' in target)) return false;
          const prototype = target.tagName === 'TEXTAREA'
            ? (globalThis as any).HTMLTextAreaElement?.prototype
            : (globalThis as any).HTMLInputElement?.prototype;
          const setter = prototype ? Object.getOwnPropertyDescriptor(prototype, 'value')?.set : undefined;
          if (setter) setter.call(target, nextValue);
          else target.value = nextValue;
          target.dispatchEvent(new Event('input', { bubbles: true }));
          target.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }) as unknown as (arg: string) => boolean),
        JSON.stringify([testId, value]),
      );
    },
    async uploadTestId(testId: string, filePath: string) {
      const handle = await page.$(`[data-testid="${testId}"]`);
      if (!handle) return false;
      const isFile = await handle.evaluate((node: any) => node?.tagName === 'INPUT' && node?.type === 'file');
      if (!isFile || typeof (handle as any).uploadFile !== 'function') return false;
      await (handle as any).uploadFile(filePath);
      await handle.evaluate((node: any) => node.dispatchEvent(new Event('change', { bubbles: true })));
      return true;
    },
    async screenshot(filePath: string) {
      await page.screenshot({ path: filePath, fullPage: false });
    },
    async reload() {
      if (page.reload) await page.reload({ waitUntil: 'networkidle2' });
      else await page.evaluate(() => location.reload());
      await sleep(800);
    },
  };
}

/**
 * Real-browser factory for the operator-QA runner. Connects to the dedicated
 * LandOS Chrome over CDP, launching it headed if necessary. Every QA journey
 * gets a fresh tab; dispose closes only that tab and disconnects.
 */
export function realBrowserFactory(options: { headed?: boolean } = {}): QaBrowserFactory {
  void options;
  return async (): Promise<QaBrowserSession> => {
    const config = readSessionConfig();
    const candidates = candidateCdpUrls(config);
    let browser: PuppeteerBrowser | null = null;
    let connectedUrl: string | null = null;
    const squatters: string[] = [];
    let launchTarget: string | null = null;
    for (const cdpUrl of candidates) {
      const identity = await verifyChromeCdpEndpoint(cdpUrl);
      if (identity.ok) {
        browser = await connectCdp(cdpUrl);
        if (browser) { connectedUrl = cdpUrl; break; }
      } else if (identity.answering) {
        squatters.push(`${cdpUrl}: ${identity.reason}`);
      } else if (!launchTarget) {
        launchTarget = cdpUrl; // first silent port — safe for our own launch
      }
    }
    if (!browser && launchTarget) {
      const launchError = launchChrome(config, launchTarget);
      if (launchError) throw new Error(launchError);
      for (let attempt = 0; attempt < 30 && !browser; attempt += 1) {
        await sleep(500);
        browser = await connectCdp(launchTarget);
      }
      if (browser) connectedUrl = launchTarget;
    }
    if (!browser) {
      throw new Error([
        `no verified Google Chrome reachable on any candidate CDP endpoint (${candidates.join(', ')}).`,
        squatters.length ? `Foreign runtimes refused: ${squatters.join(' | ')}` : 'Launch failed or the ports are blocked.',
      ].join(' '));
    }
    const staleClosed = await closeStaleQaTabs(browser);
    const page = await browser.newPage();
    let disposed = false;
    return {
      page: wrapPage(page),
      mode: 'real',
      description: `puppeteer-core over verified Chrome CDP ${connectedUrl} (dedicated LandOS profile, headed${staleClosed ? `; closed ${staleClosed} stale QA tab(s) from a prior run` : ''})`,
      async dispose() {
        if (disposed) return;
        disposed = true;
        try {
          await page.close();
        } catch {
          // tab already gone
        } finally {
          try {
            await browser!.disconnect();
          } catch {
            // connection already dropped
          }
        }
      },
    };
  };
}
