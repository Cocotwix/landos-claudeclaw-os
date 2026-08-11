// LandOS — signing in to a free public-record portal WITHOUT taking the screen.
//
// Same rule as the GIS transport: `Target.createTarget({background: true})`
// loads the page without activating the tab. Nothing here calls `bringToFront`,
// focuses, resizes or repositions Chrome, and every tab this module opens is
// closed in a `finally` — including on failure. The operator keeps working.
//
// Form filling happens inside one `evaluate`, so there is no synthetic
// keyboard or mouse input that could land in whatever window the operator
// actually has focused.
//
// Session reuse is deliberately the browser's own cookie jar rather than an
// exported cookie. The authenticated state never leaves Chrome, so there is no
// session secret to store, redact, or leak — `resume` simply asks the portal
// whether it still knows us.

import { logger } from '../logger.js';
import {
  openBackgroundPageLive,
  type BackgroundPageLike,
  type GovBrowserTransportDeps,
} from './gov-browser-transport.js';
import { redactAccountSecrets } from './government-account-manager.js';
import type { PublicRecordLoginAdapter, PublicRecordLoginResult } from './public-record-access.js';

export interface BrowserLoginDeps extends GovBrowserTransportDeps {
  /** Injected in tests so no Chrome is required. */
  openBackgroundPage?: (url: string, timeoutMs: number) => Promise<BackgroundPageLike>;
  settleMs?: number;
  navTimeoutMs?: number;
}

const DEFAULT_SETTLE_MS = 2_500;
const DEFAULT_NAV_TIMEOUT_MS = 30_000;

/**
 * Fill and submit whatever ordinary login form the page publishes.
 *
 * Runs as one expression in the page. It reports what it did rather than
 * throwing, so a portal LandOS cannot drive becomes a named operator state
 * instead of an exception.
 */
const SUBMIT_LOGIN = (username: string, password: string) => `(() => {
  const q = (sel) => Array.from(document.querySelectorAll(sel));
  const visible = (el) => !!(el.offsetParent || el.getClientRects().length);
  const pw = q('input[type="password"]').filter(visible)[0];
  if (!pw) return { status: 'no_form' };
  const form = pw.form;
  const candidates = q('input').filter((el) =>
    visible(el) && el !== pw && /^(text|email|)$/i.test(el.type || '')
    && (!form || el.form === form));
  const user = candidates.find((el) =>
    /user|email|login|account/i.test((el.name || '') + ' ' + (el.id || '') + ' ' + (el.placeholder || ''))
  ) || candidates[0];
  if (!user) return { status: 'no_form' };
  if (q('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], .g-recaptcha, .h-captcha').length) {
    return { status: 'captcha' };
  }
  const set = (el, value) => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
    if (setter && setter.set) setter.set.call(el, value); else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  set(user, ${JSON.stringify(username)});
  set(pw, ${JSON.stringify(password)});
  const submit = (form
    ? form.querySelector('button[type="submit"], input[type="submit"], button:not([type])')
    : null);
  if (submit) submit.click();
  else if (form && typeof form.requestSubmit === 'function') form.requestSubmit();
  else if (form) form.submit();
  else return { status: 'no_form' };
  return { status: 'submitted' };
})()`;

/** Reads the post-submit page for a verdict. No interaction. */
const READ_OUTCOME = `(() => {
  const text = (document.body ? document.body.innerText : '').slice(0, 4000);
  const hasPassword = !!document.querySelector('input[type="password"]');
  return { text, hasPassword, url: location.href };
})()`;

const LOCKED = /\b(account\s+(is\s+)?(locked|disabled|suspended)|too many (failed )?(login )?attempts)\b/i;
const RESET = /\b(password\s+(has\s+)?expired|must\s+(change|reset)\s+your\s+password|password\s+reset\s+required)\b/i;
const REJECTED = /\b(invalid|incorrect|unrecognized)\s+(user\s?name|username|email|password|credentials)\b|\blogin\s+failed\b|\bthose\s+credentials\s+did\s+not\s+match\b/i;
const CAPTCHA = /\b(captcha|i'?m not a robot|verify you are human)\b/i;

/**
 * A `PublicRecordLoginAdapter` backed by the background browser.
 *
 * The password is passed straight into the page expression and is never logged,
 * returned, or written anywhere; the only value that leaves this module is a
 * status.
 */
export function createBackgroundBrowserLogin(deps: BrowserLoginDeps = {}): PublicRecordLoginAdapter {
  const settleMs = deps.settleMs ?? DEFAULT_SETTLE_MS;
  const navTimeoutMs = deps.navTimeoutMs ?? DEFAULT_NAV_TIMEOUT_MS;
  const open = deps.openBackgroundPage ?? ((url, timeout) => openBackgroundPageLive(url, timeout, deps));

  const settle = async (page: BackgroundPageLike) => {
    await page.waitForFunction(
      'document.readyState === "interactive" || document.readyState === "complete"',
      { timeout: navTimeoutMs },
    ).catch(() => { /* slow page; the settle below still gives it time */ });
    await new Promise((resolve) => setTimeout(resolve, settleMs));
  };

  return {
    async login({ username, password, loginUrl }): Promise<PublicRecordLoginResult> {
      if (!loginUrl) return { status: 'human_action_required', reason: 'No sign-in URL is known for this source.' };
      let page: BackgroundPageLike | null = null;
      try {
        page = await open(loginUrl, navTimeoutMs);
        page.setDefaultNavigationTimeout?.(navTimeoutMs);
        await settle(page);

        const submitted = await page.evaluate<{ status: string }>(SUBMIT_LOGIN(username, password));
        if (submitted?.status === 'captcha') {
          return { status: 'human_action_required', reason: 'HUMAN ACTION REQUIRED: the sign-in form presents a CAPTCHA.' };
        }
        if (submitted?.status !== 'submitted') {
          return { status: 'human_action_required', reason: 'HUMAN ACTION REQUIRED: no ordinary sign-in form was found on the page.' };
        }

        await settle(page);
        const outcome = await page.evaluate<{ text: string; hasPassword: boolean; url: string }>(READ_OUTCOME);
        const text = String(outcome?.text ?? '');

        if (CAPTCHA.test(text)) return { status: 'human_action_required', reason: 'HUMAN ACTION REQUIRED: the portal presented a challenge after sign-in.' };
        if (LOCKED.test(text)) return { status: 'locked', reason: 'The portal reports the account is locked.' };
        if (RESET.test(text)) return { status: 'password_reset_required', reason: 'The portal requires a password change.' };
        if (REJECTED.test(text)) return { status: 'invalid_credentials', reason: 'The portal rejected the stored credential.' };
        // Still sitting on a password form means nothing was accepted, whatever
        // the page says about it.
        if (outcome?.hasPassword) return { status: 'failed', reason: 'The sign-in form was still present after submission.' };
        return { status: 'authenticated' };
      } catch (error) {
        const message = redactAccountSecrets((error as Error)?.message ?? 'Background sign-in failed.');
        logger.info({ event: 'public_record_browser_login_failed', msg: message }, 'public_record_browser_login_failed');
        return { status: 'failed', reason: message };
      } finally {
        // A leaked background tab is invisible to the operator and would
        // accumulate silently. Always close, including on failure.
        if (page) { try { await page.close(); } catch { /* already gone */ } }
      }
    },

    /**
     * Chrome's own profile carries the session, so "does it still work" is a
     * question for the portal, not for a stored cookie.
     */
    async resume({ loginUrl }) {
      if (!loginUrl) return { status: 'expired' };
      let page: BackgroundPageLike | null = null;
      try {
        page = await open(loginUrl, navTimeoutMs);
        page.setDefaultNavigationTimeout?.(navTimeoutMs);
        await settle(page);
        const outcome = await page.evaluate<{ text: string; hasPassword: boolean; url: string }>(READ_OUTCOME);
        return outcome?.hasPassword ? { status: 'expired' } : { status: 'authenticated' };
      } catch {
        return { status: 'expired' };
      } finally {
        if (page) { try { await page.close(); } catch { /* already gone */ } }
      }
    },
  };
}
