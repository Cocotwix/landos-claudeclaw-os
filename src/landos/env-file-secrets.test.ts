import { describe, it, expect } from 'vitest';
import { withEnvFileSecrets } from '../env.js';

// Regression: the live "Run Property Analysis" / from-verification path returned
// parcelVerified:false because the Realie adapter (and Realie/Zillow comps) read
// their key from an env object, while the app keeps secrets in the .env FILE
// (readEnvFile) and never loads them into process.env. withEnvFileSecrets bridges
// the gap so provider adapters get the configured key.
describe('withEnvFileSecrets — provider key bridging (root-cause fix)', () => {
  it('fills a key MISSING from process.env using the .env file reader', () => {
    const base = {} as NodeJS.ProcessEnv; // mimics the live server: no key in process.env
    const reader = (keys: string[]): Record<string, string> => (keys.includes('REALIE_API_KEY') ? { REALIE_API_KEY: 'file-key' } : {});
    const env = withEnvFileSecrets(['REALIE_API_KEY', 'REALIE_API_BASE'], base, reader);
    expect(env.REALIE_API_KEY).toBe('file-key'); // adapter would now be configured
  });

  it('does NOT override a key already present in the base env', () => {
    const base = { REALIE_API_KEY: 'process-key' } as NodeJS.ProcessEnv;
    let readerCalled = false;
    const reader = (keys: string[]) => { readerCalled = true; return { REALIE_API_KEY: 'file-key' }; };
    const env = withEnvFileSecrets(['REALIE_API_KEY'], base, reader);
    expect(env.REALIE_API_KEY).toBe('process-key');
    expect(readerCalled).toBe(false); // nothing missing -> no file read
  });

  it('honors LANDOS_DISABLE_DOTENV_FALLBACK (no file fallback)', () => {
    const base = { LANDOS_DISABLE_DOTENV_FALLBACK: '1' } as NodeJS.ProcessEnv;
    const reader = () => ({ REALIE_API_KEY: 'file-key' });
    const env = withEnvFileSecrets(['REALIE_API_KEY'], base, reader);
    expect(env.REALIE_API_KEY).toBeUndefined();
  });

  it('returns base unchanged when the reader throws or has nothing', () => {
    const base = { OTHER: 'x' } as NodeJS.ProcessEnv;
    expect(withEnvFileSecrets(['REALIE_API_KEY'], base, () => { throw new Error('no file'); }).REALIE_API_KEY).toBeUndefined();
    expect(withEnvFileSecrets(['REALIE_API_KEY'], base, () => ({})).REALIE_API_KEY).toBeUndefined();
  });

  it('only reads the keys actually missing (Zillow/Apify path)', () => {
    const base = { APIFY_TOKEN: 'have-it' } as NodeJS.ProcessEnv;
    let asked: string[] = [];
    const reader = (keys: string[]) => { asked = keys; return {}; };
    withEnvFileSecrets(['APIFY_TOKEN', 'LANDOS_ZILLOW_ACTOR'], base, reader);
    expect(asked).toEqual(['LANDOS_ZILLOW_ACTOR']); // APIFY_TOKEN present -> not re-read
  });
});
