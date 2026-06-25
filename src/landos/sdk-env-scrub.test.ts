// Pass 3 unit (2) — security.ts SDK env-scrub (#52). ANTHROPIC_API_KEY is dropped
// from the SDK subprocess env by default so a stale/invalid external key can't
// override a subscription (OAuth) login; CLAUDE_CODE_OAUTH_TOKEN is always kept;
// other secret-shaped vars are dropped. Opt back in via CLAUDECLAW_USE_ANTHROPIC_API_KEY.

import { describe, it, expect, afterEach } from 'vitest';
import { getScrubbedSdkEnv } from '../security.js';

const saved = { ...process.env };
afterEach(() => {
  // restore the touched keys
  for (const k of ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'FOO_API_KEY', 'CLAUDECLAW_USE_ANTHROPIC_API_KEY']) {
    if (k in saved) process.env[k] = saved[k]; else delete process.env[k];
  }
});

describe('getScrubbedSdkEnv (#52 env-scrub)', () => {
  it('drops ANTHROPIC_API_KEY by default but keeps CLAUDE_CODE_OAUTH_TOKEN', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'oauth-test';
    delete process.env.CLAUDECLAW_USE_ANTHROPIC_API_KEY;
    const env = getScrubbedSdkEnv();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('oauth-test');
  });

  it('restores ANTHROPIC_API_KEY when CLAUDECLAW_USE_ANTHROPIC_API_KEY=true', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    process.env.CLAUDECLAW_USE_ANTHROPIC_API_KEY = 'true';
    const env = getScrubbedSdkEnv();
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-test');
  });

  it('drops other secret-shaped vars (e.g. *_API_KEY)', () => {
    process.env.FOO_API_KEY = 'leak';
    const env = getScrubbedSdkEnv();
    expect(env.FOO_API_KEY).toBeUndefined();
  });

  it('authSecrets re-injection honors the opt-in flag for ANTHROPIC_API_KEY', () => {
    delete process.env.CLAUDECLAW_USE_ANTHROPIC_API_KEY;
    const blocked = getScrubbedSdkEnv({ ANTHROPIC_API_KEY: 'x', CLAUDE_CODE_OAUTH_TOKEN: 'tok' });
    expect(blocked.ANTHROPIC_API_KEY).toBeUndefined();
    expect(blocked.CLAUDE_CODE_OAUTH_TOKEN).toBe('tok');
    process.env.CLAUDECLAW_USE_ANTHROPIC_API_KEY = 'true';
    const allowed = getScrubbedSdkEnv({ ANTHROPIC_API_KEY: 'x' });
    expect(allowed.ANTHROPIC_API_KEY).toBe('x');
  });
});
