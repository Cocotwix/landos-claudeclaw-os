// The automation browser must be impossible to confuse with the operator's.
//
// The old guard only ever asked "is a Chrome answering?" — it would have
// attached to the operator's daily Chrome the moment that Chrome had a
// debugging port. These tests pin the question that actually matters: is this
// MY Chrome, running MY profile?

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_AUTOMATION_PORT,
  OFFSCREEN_CHROME_ARGS,
  automationBrowserConfig,
  isReapableAutomationTarget,
  reapOrphanAutomationTabs,
  reclaimStrandedAutomationTabs,
  userDataDirFromCommandLine,
  verifyAutomationOwnership,
  type AutomationBrowserConfig,
  type AutomationOwnership,
  type AutomationTarget,
} from './automation-browser.js';

const OPERATOR_PROFILE = 'C:\\Users\\tbutt\\AppData\\Local\\Google\\Chrome\\User Data';
const LANDOS_PROFILE = 'C:\\Users\\tbutt\\.landos-chrome';

function config(overrides: Partial<AutomationBrowserConfig> = {}): AutomationBrowserConfig {
  return {
    endpoint: 'http://127.0.0.1:9224',
    port: 9224,
    profileDir: LANDOS_PROFILE,
    chromePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    chromeChecked: [],
    ...overrides,
  };
}

function versionResponder(payload: Record<string, unknown> | null, ok = true) {
  return (async () => ({ ok, json: async () => payload })) as unknown as typeof fetch;
}

const CHROME_VERSION = { Browser: 'Chrome/150.0.7871.129', 'User-Agent': 'Mozilla/5.0 Chrome/150.0.7871.129' };

describe('automationBrowserConfig', () => {
  it('never resolves to port 9222 from any source', () => {
    // 9222 is the conventional port every other tool grabs; on this machine
    // msedgewebview2 owns it.
    expect(automationBrowserConfig({ LANDOS_AUTOMATION_CDP_PORT: '9222' } as NodeJS.ProcessEnv).port)
      .toBe(DEFAULT_AUTOMATION_PORT);
    expect(automationBrowserConfig({ BROWSER_INTEL_CDP_URL: 'http://127.0.0.1:9222' } as NodeJS.ProcessEnv).port)
      .toBe(DEFAULT_AUTOMATION_PORT);
  });

  it('honours an explicit non-9222 port and the legacy endpoint key', () => {
    expect(automationBrowserConfig({ LANDOS_AUTOMATION_CDP_PORT: '9311' } as NodeJS.ProcessEnv).port).toBe(9311);
    expect(automationBrowserConfig({ BROWSER_INTEL_CDP_URL: 'http://127.0.0.1:9224' } as NodeJS.ProcessEnv).port).toBe(9224);
  });

  it('binds the endpoint to loopback only', () => {
    expect(automationBrowserConfig({ LANDOS_AUTOMATION_CDP_PORT: '9311' } as NodeJS.ProcessEnv).endpoint)
      .toBe('http://127.0.0.1:9311');
  });
});

describe('offscreen launch args', () => {
  it('always place the window far outside any real desktop', () => {
    expect(OFFSCREEN_CHROME_ARGS).toContain('--window-position=-32000,-32000');
  });

  it('offer no foreground variant', () => {
    // A window that can be placed onscreen is a window that can take focus.
    expect(OFFSCREEN_CHROME_ARGS.some((arg) => /window-position=(?!-32000)/.test(arg))).toBe(false);
  });
});

describe('userDataDirFromCommandLine', () => {
  it('reads the quoted form', () => {
    expect(userDataDirFromCommandLine(`"chrome.exe" --user-data-dir="${LANDOS_PROFILE}" --no-first-run`))
      .toBe(LANDOS_PROFILE);
  });

  it('reads the bare form, including a profile path containing spaces', () => {
    expect(userDataDirFromCommandLine(`chrome.exe --remote-debugging-port=9224 --user-data-dir=${OPERATOR_PROFILE} --no-first-run`))
      .toBe(OPERATOR_PROFILE);
  });

  it('reads a bare value at end of line', () => {
    expect(userDataDirFromCommandLine(`chrome.exe --user-data-dir=${LANDOS_PROFILE}`)).toBe(LANDOS_PROFILE);
  });

  it('returns null when no profile is declared', () => {
    expect(userDataDirFromCommandLine('chrome.exe https://landportal.com/')).toBeNull();
    expect(userDataDirFromCommandLine(null)).toBeNull();
  });
});

describe('verifyAutomationOwnership', () => {
  it('accepts our own Chrome on our own profile', async () => {
    const result = await verifyAutomationOwnership(config(), {
      fetchImpl: versionResponder(CHROME_VERSION),
      pidForPort: async () => 25708,
      commandLine: async () => `chrome.exe --remote-debugging-port=9224 --user-data-dir=${LANDOS_PROFILE} --no-first-run`,
    });
    expect(result).toMatchObject({ owned: true, answering: true, pid: 25708, reason: null });
  });

  it('REFUSES the operator\'s Chrome even though it is genuine Chrome', async () => {
    // The whole point. Same browser family, same port, different profile.
    const result = await verifyAutomationOwnership(config(), {
      fetchImpl: versionResponder(CHROME_VERSION),
      pidForPort: async () => 4242,
      commandLine: async () => `chrome.exe --remote-debugging-port=9224 --user-data-dir="${OPERATOR_PROFILE}"`,
    });
    expect(result.owned).toBe(false);
    expect(result.reason).toContain('not the LandOS automation profile');
  });

  it('refuses a Chrome that declares no profile at all', async () => {
    const result = await verifyAutomationOwnership(config(), {
      fetchImpl: versionResponder(CHROME_VERSION),
      pidForPort: async () => 4242,
      commandLine: async () => 'chrome.exe https://landportal.com/',
    });
    expect(result.owned).toBe(false);
    expect(result.reason).toContain('declares no --user-data-dir');
  });

  it('refuses a foreign runtime squatting the port', async () => {
    const result = await verifyAutomationOwnership(config(), {
      fetchImpl: versionResponder({ Browser: 'Edg/140.0.0.0', 'User-Agent': 'Mozilla/5.0 Edg/140 WebView2' }),
      pidForPort: async () => 52828,
      commandLine: async () => 'msedgewebview2.exe',
    });
    expect(result.owned).toBe(false);
    expect(result.reason).toContain('foreign runtime');
  });

  it('refuses when the process behind the port cannot be identified', async () => {
    const result = await verifyAutomationOwnership(config(), {
      fetchImpl: versionResponder(CHROME_VERSION),
      pidForPort: async () => null,
      commandLine: async () => null,
    });
    expect(result.owned).toBe(false);
    expect(result.reason).toContain('Could not identify the process');
  });

  it('reports not-answering rather than owned when nothing is on the port', async () => {
    const result = await verifyAutomationOwnership(config(), {
      fetchImpl: (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch,
      pidForPort: async () => null,
      commandLine: async () => null,
    });
    expect(result).toMatchObject({ owned: false, answering: false });
  });

  it('treats profile paths case- and separator-insensitively', async () => {
    const result = await verifyAutomationOwnership(config(), {
      fetchImpl: versionResponder(CHROME_VERSION),
      pidForPort: async () => 25708,
      commandLine: async () => 'chrome.exe --user-data-dir=c:\\users\\tbutt\\.landos-chrome\\',
    });
    expect(result.owned).toBe(true);
  });
});

describe('isReapableAutomationTarget', () => {
  const page = (url: string, type = 'page') => ({ id: 't', type, url, title: '' });

  it('reaps automation work-product pages', () => {
    expect(isReapableAutomationTarget(page('https://landportal.com/?property=abc'))).toBe(true);
    expect(isReapableAutomationTarget(page('https://www.zillow.com/homes/'))).toBe(true);
    expect(isReapableAutomationTarget(page('https://www.redfin.com/city/1'))).toBe(true);
  });

  it('reaps a leaked dashboard tab when the origin is supplied', () => {
    expect(isReapableAutomationTarget(page('http://localhost:3141/dept/acquisitions/v2?deal=81&token=x'), 'http://localhost:3141')).toBe(true);
    expect(isReapableAutomationTarget(page('http://localhost:3141/dept/acquisitions/v2?deal=81&token=x'))).toBe(false);
  });

  it('leaves non-page targets and browser UI alone', () => {
    expect(isReapableAutomationTarget(page('https://landportal.com/', 'iframe'))).toBe(false);
    expect(isReapableAutomationTarget(page('https://landportal.com/', 'worker'))).toBe(false);
    expect(isReapableAutomationTarget(page('chrome://omnibox-popup.top-chrome/'))).toBe(false);
    expect(isReapableAutomationTarget(page('about:blank'))).toBe(false);
  });

  it('never reaps an unrelated site', () => {
    expect(isReapableAutomationTarget(page('https://mail.google.com/'))).toBe(false);
    // Host suffix matching must not be fooled by a lookalike domain.
    expect(isReapableAutomationTarget(page('https://landportal.com.evil.test/'))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Reclaiming tabs stranded by a previous LandOS process
//
// The automation Chrome outlives the runtime on purpose, so every restart used
// to strand the dying process's tabs — above all the cached LandPortal working
// tab — with nothing left alive that knew it owned them. Four such tabs and
// ~1.4 GB were observed live, reclaimable only by hand.
// ─────────────────────────────────────────────────────────────────────────

const OWNED: AutomationOwnership = { owned: true, answering: true, pid: 4242, browser: 'Chrome/150.0', reason: null };

/** A CDP HTTP double: serves /json/list and records what was closed/minted. */
function cdpDouble(targets: AutomationTarget[]) {
  const state = { targets: [...targets], closed: [] as string[], minted: 0 };
  const fetchImpl = (async (input: string) => {
    const url = String(input);
    if (url.includes('/json/list')) {
      return { ok: true, json: async () => state.targets };
    }
    if (url.includes('/json/new')) {
      state.minted += 1;
      state.targets.push({ id: `minted-${state.minted}`, type: 'page', url: 'about:blank', title: '' });
      return { ok: true, json: async () => state.targets[state.targets.length - 1] };
    }
    const close = /\/json\/close\/(.+)$/.exec(url);
    if (close) {
      const id = decodeURIComponent(close[1]);
      state.closed.push(id);
      state.targets = state.targets.filter((t) => t.id !== id);
      return { ok: true, json: async () => ({}) };
    }
    throw new Error(`unexpected CDP call ${url}`);
  }) as unknown as typeof fetch;
  return { state, fetchImpl };
}

const target = (id: string, url: string, type = 'page'): AutomationTarget => ({ id, type, url, title: '' });

describe('reclaimStrandedAutomationTabs', () => {
  it('leaves exactly one inert control page, closing every stranded tab', async () => {
    // The live before-state: three parcel tabs and a bare LandPortal session
    // tab left by four dead processes, plus the control page.
    const { state, fetchImpl } = cdpDouble([
      target('a', 'https://landportal.com/?property=aaa'),
      target('b', 'https://landportal.com/?property=bbb'),
      target('c', 'https://landportal.com/'),
      target('ctl', 'about:blank'),
      target('w', 'https://landportal.com/', 'worker'),
    ]);

    const result = await reclaimStrandedAutomationTabs({
      config: config(), fetchImpl, verifyOwnership: async () => OWNED,
    });

    expect(result.ran).toBe(true);
    expect(result.closed).toBe(3);
    expect(result.remaining).toBe(0);
    // The existing about:blank is RETAINED rather than closed and re-minted:
    // minting is a target creation, and Chrome exits with its last page.
    expect(state.minted).toBe(0);
    expect(state.targets.filter((t) => t.type === 'page').map((t) => t.id)).toEqual(['ctl']);
  });

  it('mints a control page first when every page is stranded', async () => {
    // Closing the last page takes Chrome — and the authenticated profile — down.
    const { state, fetchImpl } = cdpDouble([
      target('a', 'https://landportal.com/?property=aaa'),
      target('b', 'http://localhost:3141/dept/acquisitions/v2?deal=81&token=x'),
    ]);

    const result = await reclaimStrandedAutomationTabs({
      config: config(), fetchImpl, verifyOwnership: async () => OWNED,
    });

    expect(state.minted).toBe(1);
    expect(result.closed).toBe(2);
    expect(state.targets.filter((t) => t.type === 'page')).toHaveLength(1);
  });

  it('reports honestly instead of throwing when LandOS owns no browser', async () => {
    // No automation Chrome running is the normal case at startup, not a failure.
    const result = await reclaimStrandedAutomationTabs({
      config: config(),
      fetchImpl: (async () => { throw new Error('should not be called'); }) as unknown as typeof fetch,
      verifyOwnership: async () => ({
        owned: false, answering: false, pid: null, browser: '',
        reason: 'The automation CDP endpoint is not answering.',
      }),
    });

    expect(result.ran).toBe(false);
    expect(result.closed).toBe(0);
    expect(result.note).toContain('No owned automation browser');
  });

  it('never reaches a browser LandOS does not own', async () => {
    // The guard is the only thing standing between this and the operator's
    // Chrome, so a refusal must close nothing at all.
    const { state, fetchImpl } = cdpDouble([target('op', 'https://landportal.com/?property=aaa')]);
    const result = await reclaimStrandedAutomationTabs({
      config: config(), fetchImpl,
      verifyOwnership: async () => ({
        owned: false, answering: true, pid: 99, browser: 'Chrome/150.0',
        reason: `Process 99 is running profile "${OPERATOR_PROFILE}", not the LandOS automation profile.`,
      }),
    });
    expect(result.ran).toBe(false);
    expect(state.closed).toEqual([]);
  });
});

describe('reapOrphanAutomationTabs in-run scope', () => {
  it('stays conservative: an unrelated page survives a normal post-run reap', async () => {
    // `all-pages` is licensed by the process boundary alone. The in-run reap
    // runs while other work is legitimately in flight and must not widen.
    const { state, fetchImpl } = cdpDouble([
      target('a', 'https://landportal.com/?property=aaa'),
      target('g', 'https://gis.williamsoncounty-tn.gov/parcel/042'),
      target('ctl', 'about:blank'),
    ]);

    const result = await reapOrphanAutomationTabs({
      config: config(), fetchImpl, verifyOwnership: async () => OWNED,
    });

    expect(result.closed).toBe(1);
    expect(state.targets.map((t) => t.id).sort()).toEqual(['ctl', 'g']);
  });
});

describe('reap honesty when Chrome lags', () => {
  it('does not count a confirmed-closed target as remaining', async () => {
    // `/json/close` only ACKNOWLEDGES; the target can still be listed. Trusting
    // the raw re-read reported "remaining: 4" for a browser that had settled at
    // one page — a false leak alarm from the one honesty counter.
    const targets: AutomationTarget[] = [
      target('a', 'https://landportal.com/?property=aaa'),
      target('b', 'https://landportal.com/?property=bbb'),
      target('ctl', 'about:blank'),
    ];
    const laggingFetch = (async (input: string) => {
      const url = String(input);
      // The list NEVER drops a closed target — the worst case of the lag.
      if (url.includes('/json/list')) return { ok: true, json: async () => targets };
      if (/\/json\/close\//.test(url)) return { ok: true, json: async () => ({}) };
      throw new Error(`unexpected CDP call ${url}`);
    }) as unknown as typeof fetch;

    const result = await reclaimStrandedAutomationTabs({
      config: config(), fetchImpl: laggingFetch, verifyOwnership: async () => OWNED,
    });

    expect(result.closed).toBe(2);
    expect(result.remaining).toBe(0);
  });

  it('still counts a tab that genuinely refused to close', async () => {
    const targets: AutomationTarget[] = [
      target('stuck', 'https://landportal.com/?property=aaa'),
      target('ctl', 'about:blank'),
    ];
    const refusingFetch = (async (input: string) => {
      const url = String(input);
      if (url.includes('/json/list')) return { ok: true, json: async () => targets };
      if (/\/json\/close\//.test(url)) return { ok: false, json: async () => ({}) };
      throw new Error(`unexpected CDP call ${url}`);
    }) as unknown as typeof fetch;

    const result = await reclaimStrandedAutomationTabs({
      config: config(), fetchImpl: refusingFetch, verifyOwnership: async () => OWNED,
    });

    expect(result.closed).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.remaining).toBe(1);
  });
});
