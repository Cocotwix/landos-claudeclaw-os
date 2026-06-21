// Focused tests for the narrow LandPortal v2 config-wiring fix: lpApiVersion()
// must resolve LANDPORTAL_API_VERSION from the approved config source — exported
// process.env wins, else the local .env resolver supplies it, else safe v1
// default. Pure + injected: no real .env read, no network, no secrets.

import { describe, it, expect } from 'vitest';
import { lpApiVersion } from './landportal-client.js';

describe('lpApiVersion — approved config resolution', () => {
  it('explicit process.env.LANDPORTAL_API_VERSION=v2 takes precedence', () => {
    expect(lpApiVersion({ processEnv: { LANDPORTAL_API_VERSION: 'v2' }, readEnv: () => ({}) })).toBe('v2');
  });

  it('explicit exported value wins over the local config fallback (explicit v1 stays v1)', () => {
    const v = lpApiVersion({
      processEnv: { LANDPORTAL_API_VERSION: 'v1' },
      readEnv: () => ({ LANDPORTAL_API_VERSION: 'v2' }), // would say v2, but exported v1 wins
    });
    expect(v).toBe('v1');
  });

  it('falls back to the approved local .env resolver when process.env is unset', () => {
    expect(lpApiVersion({ processEnv: {}, readEnv: () => ({ LANDPORTAL_API_VERSION: 'v2' }) })).toBe('v2');
  });

  it('absent everywhere -> safe v1 default (existing behavior preserved)', () => {
    expect(lpApiVersion({ processEnv: {}, readEnv: () => ({}) })).toBe('v1');
  });

  it('a non-v2 local value -> v1 (only "v2" enables v2)', () => {
    expect(lpApiVersion({ processEnv: {}, readEnv: () => ({ LANDPORTAL_API_VERSION: 'beta' }) })).toBe('v1');
    expect(lpApiVersion({ processEnv: {}, readEnv: () => ({ LANDPORTAL_API_VERSION: ' V2 ' }) })).toBe('v2'); // trim + case-insensitive
  });

  it('hermetic guard (LANDOS_DISABLE_DOTENV_FALLBACK) skips the .env read entirely', () => {
    let readCalled = false;
    const v = lpApiVersion({
      processEnv: { LANDOS_DISABLE_DOTENV_FALLBACK: '1' },
      readEnv: () => { readCalled = true; return { LANDPORTAL_API_VERSION: 'v2' }; },
    });
    expect(v).toBe('v1');
    expect(readCalled).toBe(false);
  });

  it('a throwing local resolver degrades to v1 (never throws out)', () => {
    expect(lpApiVersion({ processEnv: {}, readEnv: () => { throw new Error('fs fail'); } })).toBe('v1');
  });

  it('only ever returns the literal "v1" or "v2" (no value/secret passthrough)', () => {
    const out = lpApiVersion({ processEnv: { LANDPORTAL_API_VERSION: 'v2' }, readEnv: () => ({}) });
    expect(['v1', 'v2']).toContain(out);
  });
});
