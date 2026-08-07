// Regression coverage for browser QA finding cdp-attach-foreign-browser-endpoint:
// LandOS must never attach to (or leak token-bearing pages into) a CDP endpoint
// it does not own — Edge, Electron shells, or embedded third-party runtimes
// such as Lenovo Vantage's browser squatting on 127.0.0.1:9222.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { classifyCdpVersionInfo, verifyChromeCdpEndpoint } from './browser-session.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const QA_BROWSER = fs.readFileSync(path.join(here, 'sprint-system/qa-browser.ts'), 'utf8').replace(/\r\n/g, '\n');
const SESSION = fs.readFileSync(path.join(here, 'browser-session.ts'), 'utf8').replace(/\r\n/g, '\n');

describe('CDP endpoint identity classification', () => {
  it('accepts genuine Google Chrome (headed and headless)', () => {
    expect(classifyCdpVersionInfo({ Browser: 'Chrome/126.0.6478.127', 'User-Agent': 'Mozilla/5.0 ... Chrome/126.0.0.0 Safari/537.36' }).ok).toBe(true);
    expect(classifyCdpVersionInfo({ Browser: 'HeadlessChrome/126.0.6478.127', 'User-Agent': 'Mozilla/5.0 ... HeadlessChrome/126.0.0.0' }).ok).toBe(true);
  });

  it('rejects Edge, Lenovo Vantage, Electron, WebView2, and unidentified runtimes', () => {
    const foreign = [
      { Browser: 'Edg/126.0.2592.87', 'User-Agent': 'Mozilla/5.0 ... Edg/126.0.2592.87' },
      { Browser: 'Chrome/126.0.0.0', 'User-Agent': 'Mozilla/5.0 ... Chrome/126.0.0.0 Edg/126.0.2592.87' },
      { Browser: 'Chrome/108.0.5359.215', 'User-Agent': 'Mozilla/5.0 ... LenovoVantage/3.0.0.191' },
      { Browser: 'Chrome/120.0.0.0', 'User-Agent': 'Mozilla/5.0 ... Electron/28.1.0' },
      { Browser: 'Chrome/124.0.0.0', 'User-Agent': 'Mozilla/5.0 ... WebView2/1.0' },
      { Browser: 'SomethingElse/1.0', 'User-Agent': 'custom' },
      {},
      null,
    ];
    for (const info of foreign) {
      const identity = classifyCdpVersionInfo(info as never);
      expect(identity.ok, JSON.stringify(info)).toBe(false);
      expect(identity.reason).toBeTruthy();
    }
  });

  it('verifyChromeCdpEndpoint distinguishes silent ports from foreign squatters', async () => {
    const silent = await verifyChromeCdpEndpoint('http://127.0.0.1:9222', async () => { throw new Error('ECONNREFUSED'); });
    expect(silent.ok).toBe(false);
    expect(silent.answering).toBe(false);

    const vantage = await verifyChromeCdpEndpoint('http://127.0.0.1:9222', async () => ({
      ok: true,
      json: async () => ({ Browser: 'Chrome/108.0.5359.215', 'User-Agent': 'Mozilla/5.0 LenovoVantage/3.0.0.191' }),
    }));
    expect(vantage.ok).toBe(false);
    expect(vantage.answering).toBe(true);
    expect(vantage.reason).toMatch(/foreign|Edge/i);

    const chrome = await verifyChromeCdpEndpoint('http://127.0.0.1:9222', async () => ({
      ok: true,
      json: async () => ({ Browser: 'Chrome/126.0.6478.127', 'User-Agent': 'Mozilla/5.0 Chrome/126.0.0.0' }),
    }));
    expect(chrome.ok).toBe(true);
  });
});

describe('browser layers enforce the identity gate and QA tab hygiene (source contract)', () => {
  it('qa-browser connects ONLY to the owned endpoint and never scans for one', () => {
    // This contract is deliberately inverted from its previous form. QA used to
    // scan ports 9222-9225 and attach to the first genuine Chrome that answered
    // — a runner that could fall back to an arbitrary browser, including the
    // operator's, and close tabs in it. The scan is gone.
    expect(QA_BROWSER).not.toContain('candidateCdpUrls');
    expect(QA_BROWSER).toContain('automationBrowserConfig');

    const connectBody = QA_BROWSER.match(/async function connectCdp[\s\S]*?\n\}/)?.[0] ?? '';
    expect(connectBody).toContain('verifyAutomationOwnership');
    // Ownership is proven BEFORE puppeteer is ever handed the endpoint.
    expect(connectBody.indexOf('verifyAutomationOwnership')).toBeLessThan(connectBody.indexOf("import('puppeteer-core')"));
  });

  it('QA-navigated localhost pages carry the QA marker and stale marked tabs are closed on connect', () => {
    expect(QA_BROWSER).toContain("QA_TAB_MARKER = 'landosQa=1'");
    expect(QA_BROWSER).toContain('closeStaleQaTabs');
    const gotoBody = QA_BROWSER.match(/async goto\(url: string\)[\s\S]*?\n {4}\},/)?.[0] ?? '';
    expect(gotoBody).toContain('QA_TAB_MARKER');
    const staleBody = QA_BROWSER.match(/async function closeStaleQaTabs[\s\S]*?\n\}/)?.[0] ?? '';
    expect(staleBody).toContain('QA_TAB_MARKER');
    // Only marker-carrying tabs may ever be closed — never operator tabs.
    expect(staleBody).toMatch(/url\(\)\.includes\(QA_TAB_MARKER\)/);
  });

  it('dispose is idempotent and always disconnects even when the tab close fails', () => {
    const disposeBody = QA_BROWSER.match(/async dispose\(\)[\s\S]*?\n {6}\},/)?.[0] ?? '';
    expect(disposeBody).toContain('if (disposed) return');
    expect(disposeBody).toContain('finally');
    expect(disposeBody).toContain('disconnect');
  });

  it('browser-session attaches only to the browser LandOS PROVES it owns', () => {
    // Superseded the old "is a foreign runtime answering?" contract. Checking
    // the browser TYPE was never enough: the operator's Chrome is genuine
    // Google Chrome, so a type-only gate would have attached to it the moment
    // it carried a debugging port. Ownership is now proven against the exact
    // --user-data-dir, and both paths fail closed rather than falling back.
    const ensureBody = SESSION.match(/export async function ensureBrowserSession[\s\S]*?\n\}/)?.[0] ?? '';
    expect(ensureBody).toContain('verifyAutomationOwnership');
    expect(ensureBody).toMatch(/if \(!ownership\.owned\)/);
    expect(ensureBody).toContain("state.status = 'unreachable'");

    const startBody = SESSION.match(/export async function startBrowserSession[\s\S]*?\n\}/)?.[0] ?? '';
    // Launching is delegated to the single owner module; this module no longer
    // spawns Chrome, so it no longer carries its own identity gate.
    expect(startBody).toContain('launchAutomationBrowser');
    expect(startBody).not.toContain('--remote-debugging-port');
  });
});
