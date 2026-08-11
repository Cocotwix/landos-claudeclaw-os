// LandOS — BACKGROUND browser transport for government property portals.
//
// Some vendor-hosted portals refuse a server-side request on TLS and header
// FINGERPRINT rather than on user agent, so no amount of header spoofing gets
// through. The only honest way to read those official records is a real browser.
//
// That is a transport decision, not an adapter decision. The adapters do not
// change, the normalized result contract does not change, and there is no
// browser-only result format: this module simply supplies a different
// `GovFetchText` when the direct route is refused.
//
// THE OPERATOR MUST NOT NOTICE. `browser.newPage()` opens a FOREGROUND tab and
// Chrome switches to it, which would yank the operator away from their work
// every time a county portal is read. `Target.createTarget` with
// `background: true` creates the same tab without activating it: the page
// loads, scripts run, the challenge clears, and nothing surfaces. Nothing here
// calls `bringToFront`, types, clicks, or focuses anything, and every tab this
// module opens is closed before it returns — including on failure.

import { logger } from '../logger.js';
import { ensureBrowserSession, sessionBrowser, type SessionDeps } from './browser-session.js';
import { looksBlocked, type GovFetchText, type GovTextResponse } from './gis-transport.js';

/** Minimal page surface this module needs. Kept structural so tests can fake it. */
export interface BackgroundPageLike {
  evaluate<T>(fn: string | ((...args: unknown[]) => T), ...args: unknown[]): Promise<T>;
  waitForFunction(fn: string, options?: { timeout?: number }): Promise<unknown>;
  close(): Promise<void>;
  url(): string;
  setDefaultNavigationTimeout?(ms: number): void;
}

/** Opens a background target and returns its page. Injected in tests. */
export type OpenBackgroundPage = (url: string, timeoutMs: number) => Promise<BackgroundPageLike>;

export interface GovBrowserTransportDeps {
  openBackgroundPage?: OpenBackgroundPage;
  /** Session bootstrap. Defaults to the managed shared session. */
  session?: SessionDeps;
  /** Milliseconds to let a challenge clear before reading. */
  settleMs?: number;
  navTimeoutMs?: number;
  now?: () => number;
}

const DEFAULT_SETTLE_MS = 2_500;
const DEFAULT_NAV_TIMEOUT_MS = 30_000;

/** Read the rendered document. No interaction, no scrolling, no clicks. */
const READ_DOCUMENT = `(() => ({
  html: document.documentElement ? document.documentElement.outerHTML : '',
  url: location.href,
  title: document.title || '',
}))()`;

interface PuppeteerBrowserLike {
  target(): { createCDPSession(): Promise<{ send(method: string, params: unknown): Promise<{ targetId: string }>; detach(): Promise<void> }> };
  waitForTarget(
    predicate: (t: { url(): string; _targetId?: string }) => boolean,
    options?: { timeout?: number },
  ): Promise<{ page(): Promise<BackgroundPageLike | null> }>;
}

/**
 * The real background-target opener, using the managed Chrome session.
 *
 * `Target.createTarget` with `background: true` is the entire point: it is the
 * only way to load a page in this Chrome without activating the tab.
 */
export async function openBackgroundPageLive(url: string, timeoutMs: number, deps: GovBrowserTransportDeps): Promise<BackgroundPageLike> {
  const status = await ensureBrowserSession(deps.session ?? {});
  const live = sessionBrowser();
  if (status !== 'live' || !live) {
    throw new Error(`Background browser session unavailable (${status}).`);
  }
  const browser = live as unknown as PuppeteerBrowserLike;
  const cdp = await browser.target().createCDPSession();
  try {
    const { targetId } = await cdp.send('Target.createTarget', { url, background: true });
    const target = await browser.waitForTarget(
      (t) => t._targetId === targetId || t.url() === url,
      { timeout: timeoutMs },
    );
    const page = await target.page();
    if (!page) throw new Error('background target did not expose a page');
    return page;
  } finally {
    try { await cdp.detach(); } catch { /* session already gone */ }
  }
}

/**
 * A `GovFetchText` that reads a page through a background Chrome tab.
 *
 * Returns the same shape as the direct transport so adapters cannot tell the
 * difference, except for `via`, which the operator panel uses to state the real
 * retrieval route rather than implying everything came from a clean API.
 */
export function createBackgroundBrowserFetchText(deps: GovBrowserTransportDeps = {}): GovFetchText {
  const settleMs = deps.settleMs ?? DEFAULT_SETTLE_MS;
  const navTimeoutMs = deps.navTimeoutMs ?? DEFAULT_NAV_TIMEOUT_MS;
  const open = deps.openBackgroundPage ?? ((url, timeout) => openBackgroundPageLive(url, timeout, deps));

  return async (url, options = {}) => {
    const timeoutMs = Math.min(options.timeoutMs ?? navTimeoutMs, 60_000);
    let page: BackgroundPageLike | null = null;
    try {
      page = await open(url, timeoutMs);
      page.setDefaultNavigationTimeout?.(timeoutMs);
      // createTarget already navigated; wait for the document rather than
      // navigating again, which would cost a second load.
      await page.waitForFunction(
        'document.readyState === "interactive" || document.readyState === "complete"',
        { timeout: timeoutMs },
      ).catch(() => { /* slow page; the settle below still gives it time */ });
      // A challenge page swaps itself for the real document after a moment.
      // Reading too early would capture the challenge and look like a block.
      await new Promise((resolve) => setTimeout(resolve, settleMs));

      const read = await page.evaluate<{ html: string; url: string; title: string }>(READ_DOCUMENT);
      const body = read?.html ?? '';
      const finalUrl = read?.url || url;
      return {
        status: 200,
        body,
        url: finalUrl,
        contentType: 'text/html',
        // A challenge that never cleared is still a block, even in a browser.
        blocked: looksBlocked(200, body, 'text/html'),
        via: 'background_browser',
      };
    } finally {
      // Always close, including on failure. A leaked background tab is
      // invisible to the operator and would accumulate silently.
      if (page) {
        try { await page.close(); } catch { /* already gone */ }
      }
    }
  };
}

/**
 * An INCOMPLETE certificate chain: the server did not send the issuing
 * certificate, so Node's verifier cannot build a path to a trusted root.
 *
 * This is a property of the CLIENT, not of the server's identity. A browser
 * fetches the missing issuer from the authority-information-access extension
 * the leaf itself carries and completes the chain; Node's verifier does not,
 * and rejects the handshake. Michigan's legislature serves exactly this, which
 * is why `curl` and Chrome read it and `fetch` does not.
 *
 * Nothing here weakens verification. The error is only CLASSIFIED as a
 * client-side refusal so the browser rung is tried, and the browser validates
 * the chain itself before returning a byte. A certificate that is expired,
 * self-signed or issued for another name is NOT in this list: a browser
 * refuses those too, so escalating them would open a tab to be refused again.
 */
const INCOMPLETE_CERT_CHAIN = /UNABLE_TO_VERIFY_LEAF_SIGNATURE|UNABLE_TO_GET_ISSUER_CERT(?:_LOCALLY)?/i;

/**
 * Errors that mean "this host refused THIS CLIENT" rather than "this host is
 * not there".
 *
 * The distinction decides whether a browser tab is worth opening. A TLS
 * handshake failure or a mid-request reset is the signature of fingerprint
 * filtering — precisely what the browser defeats. A DNS miss or a refused
 * connection is not, and escalating those would open a tab for every
 * speculative hostname discovery tries.
 */
export function looksLikeTransportRefusal(error: unknown): boolean {
  const message = String((error as Error)?.message ?? error ?? '');
  const code = String((error as { code?: string; cause?: { code?: string } })?.code
    ?? (error as { cause?: { code?: string } })?.cause?.code ?? '');
  // Checked first: an incomplete chain names neither a socket nor a DNS
  // failure, so it used to fall past BOTH lists and return false — the host was
  // then reported as simply unreachable and the browser that reads it perfectly
  // was never opened.
  if (INCOMPLETE_CERT_CHAIN.test(`${code} ${message}`)) return true;
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ERR_INVALID_URL|ENETUNREACH|EHOSTUNREACH/i.test(`${code} ${message}`)) return false;
  return /ECONNRESET|EPROTO|ERR_SSL|handshake|tls|socket hang up|aborted|timeout|terminated/i.test(`${code} ${message}`);
}

/**
 * Direct first, browser only if the edge refused the client.
 *
 * The order matters and is not negotiable: a plain request is faster, cheaper,
 * leaves no tab and cannot disturb the operator, so it is always tried first.
 * The browser is an escalation for transport-level refusal, not a default.
 * A genuinely empty or 404 page is NOT a refusal and does not escalate.
 */
export function withBrowserFallback(
  direct: GovFetchText,
  browser: GovFetchText,
  options: { onFallback?: (url: string) => void } = {},
): GovFetchText {
  return async (url, fetchOptions) => {
    let first: GovTextResponse | null = null;
    try {
      first = await direct(url, fetchOptions);
      if (!first.blocked) return first;
    } catch (error) {
      // Only a refusal escalates. A host that does not resolve or refuses the
      // connection is simply not there, and opening a browser tab for it would
      // burn seconds per candidate while discovery probes speculative
      // hostnames — the exact case where this runs most often.
      if (!looksLikeTransportRefusal(error)) {
        logger.info({ event: 'gov_transport_unreachable', url, msg: (error as Error)?.message }, 'gov_transport_unreachable');
        return { status: 0, body: '', url, contentType: '', blocked: false, via: 'server_fetch' };
      }
      logger.info({ event: 'gov_transport_direct_failed', url, msg: (error as Error)?.message }, 'gov_transport_direct_failed');
    }

    options.onFallback?.(url);
    logger.info({ event: 'gov_transport_browser_fallback', url }, 'gov_transport_browser_fallback');
    try {
      return await browser(url, fetchOptions);
    } catch (error) {
      // The browser could not run either. Report the ORIGINAL refusal when
      // there was one, so the operator sees the real reason.
      if (first) return first;
      return {
        status: 0,
        body: '',
        url,
        contentType: '',
        blocked: true,
        via: 'background_browser',
      };
    }
  };
}
