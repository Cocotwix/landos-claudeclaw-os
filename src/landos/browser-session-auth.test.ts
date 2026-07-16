import { describe, it, expect, beforeEach } from 'vitest';
import os from 'os';
import {
  ensureLandPortalAuthenticated, readLandPortalCreds, LANDPORTAL_CRED_ENV, _resetBrowserSession,
  type PuppeteerLike, type BrowserLike, type PageLike, type BrowserSessionConfig,
} from './browser-session.js';

const LIVE: BrowserSessionConfig = { enabled: true, cdpUrl: 'http://127.0.0.1:9222', screenshotDir: os.tmpdir() + '/landos-auth-shots', profileDir: os.tmpdir() + '/landos-auth-profile' };
const CREDS = { email: 'ops@example.com', password: 'sup3r-secret-pw' };

// A fake page that routes evaluate() by the function body it receives, and steps
// through a scripted sequence of loginLike states across readPage calls.
function fakeController(opts: { loginLikeSeq: boolean[]; loginCode?: string; challenge?: string | null; onLogin?: (e: string, p: string) => void }) {
  let i = 0;
  const page: PageLike = {
    async goto() {},
    url() { return 'https://landportal.example/'; },
    async evaluate<T>(fn: unknown, ...args: unknown[]): Promise<T> {
      const src = String(fn);
      if (src.includes('no_password_field')) { // LP_LOGIN(email, password)
        opts.onLogin?.(String(args[0]), String(args[1]));
        return (opts.loginCode ?? 'submitted') as unknown as T;
      }
      if (src.includes('are you a human')) return (opts.challenge ?? null) as unknown as T; // LP_CHALLENGE
      if (src.includes('accept all')) return 0 as unknown as T; // LP_DISMISS_POPUPS
      // readPage EXTRACT_FN → next scripted loginLike
      const loginLike = opts.loginLikeSeq[Math.min(i, opts.loginLikeSeq.length - 1)];
      i += 1;
      return { url: 'https://landportal.example/', fields: {}, snippets: [], loginLike } as unknown as T;
    },
    async screenshot() {},
  };
  const browser: BrowserLike = {
    async version() { return 'HeadlessChrome/1'; },
    async pages() { return [page]; },
    async newPage() { return page; },
    isConnected() { return true; },
    async disconnect() {},
  };
  const pup: PuppeteerLike = { async connect() { return browser; } };
  return pup;
}

const deps = (pup: PuppeteerLike, over: Record<string, unknown> = {}) => ({ config: LIVE, puppeteer: pup, landportalUrl: 'https://landportal.example/', settleMs: 1, readCreds: () => ({ creds: CREDS, missing: [] as string[] }), ...over });

beforeEach(() => _resetBrowserSession());

describe('ensureLandPortalAuthenticated — automatic login', () => {
  it('detects an already-authenticated session without attempting login', async () => {
    let loginAttempts = 0;
    const pup = fakeController({ loginLikeSeq: [false], onLogin: () => { loginAttempts++; } });
    const r = await ensureLandPortalAuthenticated(deps(pup));
    expect(r.phase).toBe('authenticated');
    expect(r.ready).toBe(true);
    expect(r.attempted).toBe(false);
    expect(loginAttempts).toBe(0);
  });

  it('logs in automatically from env credentials when a login page is shown', async () => {
    let used: { e: string; p: string } | null = null;
    const pup = fakeController({ loginLikeSeq: [true, false], loginCode: 'submitted', onLogin: (e, p) => { used = { e, p }; } });
    const r = await ensureLandPortalAuthenticated(deps(pup));
    expect(r.phase).toBe('authenticated');
    expect(r.attempted).toBe(true);
    expect(used).toEqual({ e: CREDS.email, p: CREDS.password }); // creds were typed into the form
  });

  it('reports the exact missing env var names when credentials are absent', async () => {
    const pup = fakeController({ loginLikeSeq: [true] });
    const r = await ensureLandPortalAuthenticated(deps(pup, { readCreds: () => ({ creds: null, missing: [LANDPORTAL_CRED_ENV.email, LANDPORTAL_CRED_ENV.password] }) }));
    expect(r.phase).toBe('no_credentials');
    expect(r.missingEnv).toEqual(['LANDPORTAL_EMAIL', 'LANDPORTAL_PASSWORD']);
    expect(r.reason).toMatch(/set LANDPORTAL_EMAIL and LANDPORTAL_PASSWORD/i);
  });

  it('diagnoses a changed login UI (form not found) with an exact reason', async () => {
    const pup = fakeController({ loginLikeSeq: [true], loginCode: 'no_email_field' });
    const r = await ensureLandPortalAuthenticated(deps(pup));
    expect(r.phase).toBe('auth_failed');
    expect(r.reason).toMatch(/login form not found|login UI may have changed/i);
  });

  it('diagnoses wrong credentials (still a login page after submit)', async () => {
    const pup = fakeController({ loginLikeSeq: [true, true], loginCode: 'submitted' });
    const r = await ensureLandPortalAuthenticated(deps(pup));
    expect(r.phase).toBe('auth_failed');
    expect(r.reason).toMatch(/credentials may be wrong|still shows a login page/i);
  });

  it('diagnoses a captcha / 2FA challenge it cannot auto-clear', async () => {
    const pup = fakeController({ loginLikeSeq: [true], challenge: 'captcha' });
    const r = await ensureLandPortalAuthenticated(deps(pup));
    expect(r.phase).toBe('auth_failed');
    expect(r.reason).toMatch(/captcha/i);
    expect(r.attempted).toBe(false);
  });

  it('NEVER leaks credential values in the returned readiness', async () => {
    const pup = fakeController({ loginLikeSeq: [true, false], loginCode: 'submitted' });
    const r = await ensureLandPortalAuthenticated(deps(pup));
    const serialized = JSON.stringify(r);
    expect(serialized).not.toContain(CREDS.email);
    expect(serialized).not.toContain(CREDS.password);
  });
});

// Fake for the 2026-07 LandPortal homepage change: the login form is HIDDEN
// inside a modal until a visible "Log in" trigger is clicked. Routes evaluate()
// by function-body markers; scripts a sequence of LP_LOGIN codes.
function modalFakeController(opts: {
  loginLikeSeq: boolean[];
  loginCodes: string[];               // successive LP_LOGIN results
  openLoginResult?: string;           // LP_OPEN_LOGIN result ('clicked' | 'no_trigger')
  onLogin?: (e: string, p: string) => void;
  onOpenLogin?: () => void;
}) {
  let i = 0; let li = 0;
  const page: PageLike = {
    async goto() {},
    url() { return 'https://landportal.example/'; },
    async evaluate<T>(fn: unknown, ...args: unknown[]): Promise<T> {
      const src = String(fn);
      if (src.includes('no_password_field')) { // LP_LOGIN
        opts.onLogin?.(String(args[0]), String(args[1]));
        const code = opts.loginCodes[Math.min(li, opts.loginCodes.length - 1)];
        li += 1;
        return code as unknown as T;
      }
      if (src.includes('no_trigger')) { // LP_OPEN_LOGIN
        opts.onOpenLogin?.();
        return (opts.openLoginResult ?? 'no_trigger') as unknown as T;
      }
      if (src.includes('are you a human')) return null as unknown as T; // LP_CHALLENGE
      if (src.includes('accept all')) return 0 as unknown as T; // LP_DISMISS_POPUPS
      const loginLike = opts.loginLikeSeq[Math.min(i, opts.loginLikeSeq.length - 1)];
      i += 1;
      return { url: 'https://landportal.example/', fields: {}, snippets: [], loginLike } as unknown as T;
    },
    async screenshot() {},
  };
  const browser: BrowserLike = {
    async version() { return 'HeadlessChrome/1'; },
    async pages() { return [page]; },
    async newPage() { return page; },
    isConnected() { return true; },
    async disconnect() {},
  };
  const pup: PuppeteerLike = { async connect() { return browser; } };
  return pup;
}

describe('ensureLandPortalAuthenticated — hidden modal login form (2026-07 UI)', () => {
  it('clicks the Log in trigger, retries, and authenticates when the modal form appears', async () => {
    let opened = 0; let logins = 0;
    const pup = modalFakeController({
      loginLikeSeq: [true, false],
      loginCodes: ['no_email_field', 'submitted'], // hidden first, visible after trigger
      openLoginResult: 'clicked',
      onOpenLogin: () => { opened++; },
      onLogin: () => { logins++; },
    });
    const r = await ensureLandPortalAuthenticated(deps(pup));
    expect(opened).toBe(1);          // the trigger was clicked exactly once
    expect(logins).toBe(2);          // initial attempt + post-modal retry
    expect(r.phase).toBe('authenticated');
    expect(r.ready).toBe(true);
    expect(r.attempted).toBe(true);
  });

  it('reports the trigger attempt in the failure reason when the form stays unusable', async () => {
    const pup = modalFakeController({
      loginLikeSeq: [true],
      loginCodes: ['no_email_field', 'no_email_field'],
      openLoginResult: 'clicked',
    });
    const r = await ensureLandPortalAuthenticated(deps(pup));
    expect(r.phase).toBe('auth_failed');
    expect(r.reason).toMatch(/Log in trigger was clicked and the form was still not usable/i);
  });

  it('reports no-trigger when neither a visible form nor a Log in trigger exists', async () => {
    const pup = modalFakeController({
      loginLikeSeq: [true],
      loginCodes: ['no_email_field'],
      openLoginResult: 'no_trigger',
    });
    const r = await ensureLandPortalAuthenticated(deps(pup));
    expect(r.phase).toBe('auth_failed');
    expect(r.reason).toMatch(/no visible form and no Log in trigger found/i);
  });

  it('never leaks credentials through the modal retry path', async () => {
    const pup = modalFakeController({ loginLikeSeq: [true, false], loginCodes: ['no_email_field', 'submitted'], openLoginResult: 'clicked' });
    const r = await ensureLandPortalAuthenticated(deps(pup));
    const serialized = JSON.stringify(r);
    expect(serialized).not.toContain(CREDS.email);
    expect(serialized).not.toContain(CREDS.password);
  });
});

describe('readLandPortalCreds', () => {
  it('reports both missing var names from an empty env', () => {
    const { creds, missing } = readLandPortalCreds({});
    expect(creds).toBeNull();
    expect(missing).toEqual(['LANDPORTAL_EMAIL', 'LANDPORTAL_PASSWORD']);
  });
  it('returns creds when both env vars are present', () => {
    const { creds, missing } = readLandPortalCreds({ LANDPORTAL_EMAIL: 'a@b.com', LANDPORTAL_PASSWORD: 'x' });
    expect(missing).toEqual([]);
    expect(creds).toEqual({ email: 'a@b.com', password: 'x' });
  });
});
