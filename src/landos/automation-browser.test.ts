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
  userDataDirFromCommandLine,
  verifyAutomationOwnership,
  type AutomationBrowserConfig,
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
