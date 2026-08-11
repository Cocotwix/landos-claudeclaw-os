import { describe, expect, it } from 'vitest';
import { createBackgroundBrowserLogin } from './public-record-browser-login.js';
import type { BackgroundPageLike } from './gov-browser-transport.js';

/**
 * A page stand-in that records everything the adapter did to it. The point of
 * these tests is as much what is NOT called (`bringToFront`, focus, click on
 * anything outside the form) as what is.
 */
function fakePage(script: {
  submit?: { status: string };
  outcome?: { text: string; hasPassword: boolean; url: string };
  throwOn?: 'open' | 'submit';
}) {
  const calls: string[] = [];
  let closed = 0;
  const page: BackgroundPageLike & { calls: string[]; closed: () => number } = {
    calls,
    closed: () => closed,
    async evaluate<T>(fn: string | ((...args: unknown[]) => T)): Promise<T> {
      const source = String(fn);
      if (source.includes('input[type="password"]') && source.includes('submitted')) {
        calls.push('submit');
        if (script.throwOn === 'submit') throw new Error('page detached');
        return (script.submit ?? { status: 'submitted' }) as T;
      }
      calls.push('read');
      return (script.outcome ?? { text: 'Welcome', hasPassword: false, url: 'https://x.gov/home' }) as T;
    },
    async waitForFunction() { calls.push('wait'); return null; },
    async close() { closed += 1; },
    url() { return 'https://records.alpha-county.gov/login'; },
    setDefaultNavigationTimeout() { calls.push('timeout'); },
  };
  return page;
}

function adapterFor(page: ReturnType<typeof fakePage>, opened: string[] = []) {
  return {
    opened,
    adapter: createBackgroundBrowserLogin({
      settleMs: 0,
      openBackgroundPage: async (url) => { opened.push(url); return page; },
    }),
  };
}

const CREDENTIALS = { username: 'landos_alpha', password: 'transient-not-persisted', loginUrl: 'https://records.alpha-county.gov/login' };

describe('background-browser sign-in', () => {
  it('signs in through a background tab and always closes it', async () => {
    const page = fakePage({});
    const { adapter, opened } = adapterFor(page);
    const result = await adapter.login(CREDENTIALS);

    expect(result).toEqual({ status: 'authenticated' });
    expect(opened).toEqual(['https://records.alpha-county.gov/login']);
    expect(page.closed()).toBe(1);
    // Nothing that could steal the operator's screen or keyboard.
    expect(page.calls).not.toContain('bringToFront');
    expect(page).not.toHaveProperty('focus');
    expect(page).not.toHaveProperty('bringToFront');
  });

  it('closes the tab even when the page dies mid-flow', async () => {
    const page = fakePage({ throwOn: 'submit' });
    const { adapter } = adapterFor(page);
    const result = await adapter.login(CREDENTIALS);
    expect(result.status).toBe('failed');
    expect(page.closed()).toBe(1);
  });

  it('names the real state instead of guessing', async () => {
    const cases: Array<[Parameters<typeof fakePage>[0], string]> = [
      [{ submit: { status: 'captcha' } }, 'human_action_required'],
      [{ submit: { status: 'no_form' } }, 'human_action_required'],
      [{ outcome: { text: 'Your account is locked.', hasPassword: true, url: 'x' } }, 'locked'],
      [{ outcome: { text: 'Your password has expired.', hasPassword: true, url: 'x' } }, 'password_reset_required'],
      [{ outcome: { text: 'Invalid username or password.', hasPassword: true, url: 'x' } }, 'invalid_credentials'],
      [{ outcome: { text: 'Please sign in', hasPassword: true, url: 'x' } }, 'failed'],
    ];
    for (const [script, expected] of cases) {
      const { adapter } = adapterFor(fakePage(script));
      expect((await adapter.login(CREDENTIALS)).status).toBe(expected);
    }
  });

  it('never returns or leaks the password', async () => {
    const { adapter } = adapterFor(fakePage({ outcome: { text: 'Invalid password.', hasPassword: true, url: 'x' } }));
    const result = await adapter.login(CREDENTIALS);
    expect(JSON.stringify(result)).not.toContain(CREDENTIALS.password);
  });

  it('stops honestly when no sign-in URL is known', async () => {
    const { adapter, opened } = adapterFor(fakePage({}));
    const result = await adapter.login({ ...CREDENTIALS, loginUrl: null });
    expect(result.status).toBe('human_action_required');
    expect(opened).toEqual([]);
  });

  it('resumes by asking the portal, not by trusting a stored cookie', async () => {
    const live = fakePage({ outcome: { text: 'Welcome back', hasPassword: false, url: 'x' } });
    const { adapter } = adapterFor(live);
    expect(await adapter.resume!({ sessionMaterial: '', loginUrl: CREDENTIALS.loginUrl })).toEqual({ status: 'authenticated' });
    expect(live.closed()).toBe(1);

    const gone = fakePage({ outcome: { text: 'Sign in', hasPassword: true, url: 'x' } });
    const second = adapterFor(gone);
    expect(await second.adapter.resume!({ sessionMaterial: '', loginUrl: CREDENTIALS.loginUrl })).toEqual({ status: 'expired' });
    expect(gone.closed()).toBe(1);
  });
});
