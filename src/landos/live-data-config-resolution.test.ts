// Regression: live-comps config must resolve from the APPROVED source
// (.env via readEnvFile, exported process.env wins) WITHOUT populating
// process.env, and the resolved config must reach BOTH the preflight/status path
// and the live-provider registration path. Secrets must never appear in the
// status payload.

import { describe, it, expect } from 'vitest';
import {
  resolveLiveDataEnv,
  preflightLiveData,
  LIVE_DATA_ENV_KEYS,
} from './live-data-preflight.js';
import { liveCompsReadinessStatus } from './routes.js';
import { registerLiveProviders } from './providers/register-live-providers.js';

const K = LIVE_DATA_ENV_KEYS;
const downGemma = async () => ({ reachable: false, modelPresent: false });

/** Fake .env contents (synthetic — never real secrets). */
function fakeFile(over: Record<string, string> = {}): Record<string, string> {
  return {
    [K.liveComps]: '1',
    [K.apifyToken]: 'file-token',
    [K.apifyRedfinSearchActor]: 'file/search',
    [K.apifyRedfinDetailActor]: 'file/detail',
    ...over,
  };
}

describe('resolveLiveDataEnv — approved source, process.env precedence, no process.env mutation', () => {
  it('(a) .env-backed config is recognized by preflight WITHOUT populating process.env', async () => {
    const processEnv: Record<string, string | undefined> = {}; // nothing exported
    const resolved = resolveLiveDataEnv({
      processEnv,
      readEnv: () => fakeFile(),
      disableDotenvFallback: false,
    });
    expect(resolved[K.apifyToken]).toBe('file-token');
    // The supplied process.env object is NOT mutated, and the global one is untouched.
    expect(processEnv).not.toHaveProperty(K.apifyToken);
    expect(process.env[K.apifyToken]).toBeUndefined();

    const pf = await preflightLiveData({ env: resolved, probeGemma: downGemma });
    expect(pf.comps.ready).toBe(true);
    expect(pf.comps.missing).toEqual([]);
  });

  it('(b) a genuinely-exported process.env value overrides the .env value', () => {
    const resolved = resolveLiveDataEnv({
      processEnv: { [K.apifyToken]: 'env-token' },
      readEnv: () => fakeFile(),
      disableDotenvFallback: false,
    });
    expect(resolved[K.apifyToken]).toBe('env-token'); // exported wins
    expect(resolved[K.apifyRedfinSearchActor]).toBe('file/search'); // others still from file
  });

  it('an EMPTY exported value does not override a present .env value', () => {
    const resolved = resolveLiveDataEnv({
      processEnv: { [K.apifyToken]: '   ' },
      readEnv: () => fakeFile(),
      disableDotenvFallback: false,
    });
    expect(resolved[K.apifyToken]).toBe('file-token');
  });

  it('honors the hermetic LANDOS_DISABLE_DOTENV_FALLBACK guard (skips the .env read)', () => {
    let readCalled = false;
    const resolved = resolveLiveDataEnv({
      processEnv: { LANDOS_DISABLE_DOTENV_FALLBACK: '1' },
      readEnv: () => { readCalled = true; return fakeFile(); },
    });
    expect(readCalled).toBe(false);
    expect(resolved[K.apifyToken]).toBeUndefined();
  });
});

describe('(c) provider registration receives the resolved config', () => {
  it('wires live Redfin using the resolved (.env-backed) token + actors', async () => {
    const resolved = resolveLiveDataEnv({ processEnv: {}, readEnv: () => fakeFile(), disableDotenvFallback: false });
    let seenToken: string | undefined;
    const res = await registerLiveProviders({
      env: resolved,
      makeRunner: (token) => { seenToken = token; return { async run() { return []; } }; },
    });
    expect(res.compsLive).toBe(true);
    expect(seenToken).toBe('file-token'); // runner built from the resolved token
    expect(res.reason).toMatch(/file\/search -> file\/detail/); // resolved actors
  });

  it('stays stubbed (no runner built) when the resolved config is incomplete', async () => {
    const resolved = resolveLiveDataEnv({
      processEnv: {},
      readEnv: () => fakeFile({ [K.apifyRedfinDetailActor]: '' }), // detail missing
      disableDotenvFallback: false,
    });
    let runnerBuilt = false;
    const res = await registerLiveProviders({
      env: resolved,
      makeRunner: () => { runnerBuilt = true; return { async run() { return []; } }; },
    });
    expect(res.compsLive).toBe(false);
    expect(runnerBuilt).toBe(false);
    expect(res.reason).toMatch(/APIFY_REDFIN_DETAIL_ACTOR/);
  });
});

describe('(d) secrets never appear in the status payload', () => {
  it('liveCompsReadinessStatus exposes only booleans/zeros — no token or actor slug', async () => {
    const resolved = resolveLiveDataEnv({
      processEnv: {},
      readEnv: () => fakeFile({ [K.apifyToken]: 'SECRET-TOK-XYZ', [K.apifyRedfinSearchActor]: 'secret/search', [K.apifyRedfinDetailActor]: 'secret/detail' }),
      disableDotenvFallback: false,
    });
    const pf = await preflightLiveData({ env: resolved, probeGemma: downGemma });
    const status = liveCompsReadinessStatus(pf);
    expect(status.redfinCompsReady).toBe(true);

    const json = JSON.stringify(status);
    expect(json).not.toMatch(/SECRET-TOK-XYZ/);
    expect(json).not.toMatch(/secret\/search/);
    expect(json).not.toMatch(/secret\/detail/);
    for (const v of Object.values(status)) expect(['boolean', 'number'].includes(typeof v)).toBe(true);
  });
});
