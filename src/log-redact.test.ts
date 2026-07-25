/**
 * Log redaction contract.
 *
 * Every secret in this file is SYNTHETIC. Nothing here reads, derives from, or
 * asserts against a real credential — the tests install their own value source
 * so the real .env is never consulted.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Writable } from 'stream';
import fs from 'fs';
import path from 'path';
import pino from 'pino';

import {
  DEFAULT_PROTECTED_ENV_VARS,
  hasSecret,
  redactString,
  redactValue,
  refreshProtectedValues,
  setProtectedValueSource,
} from './log-redact.js';
import { redactingLogMethod } from './logger.js';

// ── Synthetic fixtures ───────────────────────────────────────────────
// Shaped like the real thing so the shape rules are genuinely exercised, but
// every one of these is invented and matches nothing that exists.
const SYNTH_TELEGRAM = '123456789:AAFakeSyntheticTelegramTokenValue00000';
const SYNTH_DASHBOARD = 'synthetic-dashboard-token-8f3a1c7e9b2d4056';
const SYNTH_DB_KEY = 'synthetic-db-encryption-key-4c1f9a77';
const SYNTH_SHAPELESS = 'zzzz-shapeless-registered-secret-zzzz';
const SYNTH_SHORT = 'tinyval';

const SYNTH_VALUES = [SYNTH_TELEGRAM, SYNTH_DASHBOARD, SYNTH_DB_KEY, SYNTH_SHAPELESS, SYNTH_SHORT];

beforeEach(() => {
  setProtectedValueSource(() => SYNTH_VALUES.filter((v) => v.length >= 9));
});

afterAll(() => {
  setProtectedValueSource(null);
});

/** Assert a rendered payload carries none of the synthetic secrets. */
function expectClean(rendered: string): void {
  for (const secret of [SYNTH_TELEGRAM, SYNTH_DASHBOARD, SYNTH_DB_KEY, SYNTH_SHAPELESS]) {
    expect(rendered).not.toContain(secret);
  }
}

// ── Normal strings ───────────────────────────────────────────────────

describe('redactString — credential shapes', () => {
  it('redacts a Telegram bot token inside an api.telegram.org URL', () => {
    const input =
      `request to https://api.telegram.org/bot${SYNTH_TELEGRAM}/getUpdates failed, reason: socket hang up`;
    const out = redactString(input);
    expect(out).not.toContain(SYNTH_TELEGRAM);
    expect(out).not.toContain('AAFakeSyntheticTelegramTokenValue00000');
    expect(out).toContain('api.telegram.org/bot');
    expect(out).toContain('socket hang up');
  });

  it('redacts a Telegram token that is NOT a registered value, keeping the bot id', () => {
    // Shape rule only — this token is not in the registered value list, which
    // is the case for any bot other than the one this process is configured
    // with. The numeric bot id survives: it identifies which bot failed and is
    // not itself a credential.
    const other = '987654321:AAOtherSyntheticTelegramTokenValue11111';
    const out = redactString(`request to https://api.telegram.org/bot${other}/getMe failed`);
    expect(out).not.toContain('AAOtherSyntheticTelegramTokenValue11111');
    expect(out).toContain('api.telegram.org/bot987654321:<redacted>');
  });

  it('redacts a bare Telegram bot token outside a URL', () => {
    const out = redactString(`token ${SYNTH_TELEGRAM} rejected`);
    expect(out).not.toContain('AAFakeSyntheticTelegramTokenValue00000');
  });

  it('redacts bearer, basic and token authorization values', () => {
    expect(redactString('Authorization: Bearer abcdefghijklmnop1234'))
      .not.toContain('abcdefghijklmnop1234');
    expect(redactString('Authorization: Basic dXNlcjpwYXNzd29yZDEyMw=='))
      .not.toContain('dXNlcjpwYXNzd29yZDEyMw==');
    expect(redactString('authorization: token ghs_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'))
      .not.toContain('ghs_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  });

  it('redacts provider key shapes', () => {
    expect(redactString('key sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAA failed'))
      .not.toContain('sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAA');
    expect(redactString('ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'))
      .not.toContain('ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    expect(redactString('xoxb-1111111111-2222222222-abcdefghij'))
      .not.toContain('xoxb-1111111111-2222222222-abcdefghij');
    expect(redactString('AIzaSyDsyntheticGoogleKeyValue000000000'))
      .not.toContain('AIzaSyDsyntheticGoogleKeyValue000000000');
    expect(redactString('gsk_syntheticGroqKeyValue0000000000'))
      .not.toContain('gsk_syntheticGroqKeyValue0000000000');
    expect(redactString('AKIAIOSFODNN7EXAMPLE')).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });

  it('redacts a JWT', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SyntheticSignature01';
    expect(redactString(`cookie session=${jwt}`)).not.toContain(jwt);
  });
});

// ── Authenticated URLs and query parameters ──────────────────────────

describe('redactString — authenticated URLs', () => {
  it('redacts credentials in a URL userinfo section', () => {
    const out = redactString('connecting to https://admin:hunter2secret@internal.example.com/db');
    expect(out).not.toContain('hunter2secret');
    expect(out).not.toContain('admin:hunter2secret');
    expect(out).toContain('internal.example.com/db');
  });

  it('redacts credentials in non-http schemes', () => {
    const out = redactString('postgres://landos:supersecretpw@localhost:5432/landos');
    expect(out).not.toContain('supersecretpw');
  });

  it('redacts a dashboard token carried as a query parameter', () => {
    const out = redactString(`GET http://localhost:3141/deals?token=${SYNTH_DASHBOARD}&tab=intel`);
    expect(out).not.toContain(SYNTH_DASHBOARD);
    // Non-secret parameters and the path survive.
    expect(out).toContain('/deals?token=');
    expect(out).toContain('&tab=intel');
  });

  it('redacts other sensitive query parameter names', () => {
    for (const param of ['access_token', 'api_key', 'apikey', 'client_secret', 'password', 'sig', 'signature']) {
      const out = redactString(`https://x.test/a?${param}=SyntheticValue123456&keep=yes`);
      expect(out).not.toContain('SyntheticValue123456');
      expect(out).toContain('keep=yes');
    }
  });

  it('leaves ordinary query parameters alone', () => {
    const url = 'http://localhost:3141/api/deals?dealId=32&county=Roane&code=TN&key=apn';
    expect(redactString(url)).toBe(url);
  });
});

// ── Registered environment secret values ─────────────────────────────

describe('redactString — registered secret values', () => {
  it('redacts a registered value that has no recognisable shape', () => {
    const out = redactString(`provider rejected credential ${SYNTH_SHAPELESS} at step 3`);
    expect(out).not.toContain(SYNTH_SHAPELESS);
    expect(out).toContain('provider rejected credential');
    expect(out).toContain('at step 3');
  });

  it('redacts every occurrence, not just the first', () => {
    const out = redactString(`${SYNTH_DB_KEY} then ${SYNTH_DB_KEY} again`);
    expect(out).not.toContain(SYNTH_DB_KEY);
    expect(out.match(/<redacted>/g)).toHaveLength(2);
  });

  it('handles multiple registered secrets in one string', () => {
    const out = redactString(`a=${SYNTH_DASHBOARD} b=${SYNTH_SHAPELESS} c=${SYNTH_DB_KEY}`);
    expectClean(out);
  });

  it('does not use a short value as a needle', () => {
    // A 7-character value would blank unrelated log lines that happen to
    // contain the same substring, so it is deliberately not registered.
    const out = redactString(`harmless ${SYNTH_SHORT} sentence`);
    expect(out).toContain(SYNTH_SHORT);
  });

  it('reads registered values from the environment by default', () => {
    const prevToken = process.env.TELEGRAM_BOT_TOKEN;
    const prevFlag = process.env.LANDOS_DISABLE_DOTENV_FALLBACK;
    // Block the .env fallback so this test reads nothing but what it sets.
    process.env.LANDOS_DISABLE_DOTENV_FALLBACK = '1';
    process.env.TELEGRAM_BOT_TOKEN = SYNTH_SHAPELESS;
    try {
      setProtectedValueSource(null);
      refreshProtectedValues();
      expect(redactString(`leak ${SYNTH_SHAPELESS}`)).not.toContain(SYNTH_SHAPELESS);
    } finally {
      if (prevToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
      else process.env.TELEGRAM_BOT_TOKEN = prevToken;
      if (prevFlag === undefined) delete process.env.LANDOS_DISABLE_DOTENV_FALLBACK;
      else process.env.LANDOS_DISABLE_DOTENV_FALLBACK = prevFlag;
      setProtectedValueSource(null);
    }
  });

  it('hasSecret reports registered values and known shapes', () => {
    expect(hasSecret(`x ${SYNTH_SHAPELESS} y`)).toBe(true);
    expect(hasSecret('Authorization: Bearer abcdefghijklmnop1234')).toBe(true);
    expect(hasSecret('deal 32 intelligence refreshed in 412ms')).toBe(false);
  });
});

// ── Ordinary content must survive untouched ──────────────────────────

describe('redactString — leaves ordinary content alone', () => {
  const untouched = [
    'Deal 32 identity confirmed (confidence 1.0)',
    // Placeholder paths, not this machine's: the assertion is about the SHAPE
    // (Windows backslashes, an MSYS-style path) surviving redaction untouched.
    'C:\\Users\\operator\\claudeclaw-os\\logs\\main.log',
    '/c/Users/operator/claudeclaw-os/store/claudeclaw.db',
    'HEAD at 0fccf8bc9dc240ed02cbcff74057b56e91f8dcd5',
    'commit 150a9db reconcile equivalent parcel identifiers',
    'model=claude-opus-5 input_tokens=1234 output_tokens=567 total_tokens=1801',
    'http://localhost:3141/api/health',
    'ws://127.0.0.1:7860',
    'APN 073090 04200 owner SACHAN DILEEP S situs OLD RIDGE RD',
    'War Room LIVE mode on ws://127.0.0.1:7860 (agent=main mode=live)',
    'basic checks passed in 12ms',
  ];

  for (const sample of untouched) {
    it(`passes through: ${sample.slice(0, 48)}`, () => {
      expect(redactString(sample)).toBe(sample);
    });
  }
});

// ── Nested objects, arrays and metadata ──────────────────────────────

describe('redactValue — nested structures', () => {
  it('redacts secrets nested deep inside objects', () => {
    const payload = {
      stage: 'provider-init',
      attempt: 2,
      config: {
        provider: { name: 'telegram', auth: { botToken: SYNTH_TELEGRAM } },
      },
    };
    const out = redactValue(payload) as typeof payload;
    expectClean(JSON.stringify(out));
    expect(out.stage).toBe('provider-init');
    expect(out.attempt).toBe(2);
    expect(out.config.provider.name).toBe('telegram');
  });

  it('redacts secrets inside nested arrays', () => {
    const payload = { attempts: [{ url: `https://x.test/a?token=${SYNTH_DASHBOARD}` }, ['inner', SYNTH_SHAPELESS]] };
    const out = redactValue(payload);
    expectClean(JSON.stringify(out));
  });

  it('redacts serialized metadata carrying a secret', () => {
    const serialized = JSON.stringify({ headers: { authorization: `Bearer ${SYNTH_DASHBOARD}` } });
    const out = redactValue({ raw: serialized }) as { raw: string };
    expect(out.raw).not.toContain(SYNTH_DASHBOARD);
  });

  it('redacts request and response metadata', () => {
    const payload = {
      req: {
        method: 'POST',
        url: `/api/dashboard/sessions?token=${SYNTH_DASHBOARD}`,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${SYNTH_DASHBOARD}`,
          cookie: `landos_session=${SYNTH_DB_KEY}; theme=dark`,
          'x-api-key': SYNTH_SHAPELESS,
        },
      },
      res: {
        statusCode: 200,
        headers: { 'set-cookie': `landos_session=${SYNTH_DB_KEY}; HttpOnly` },
      },
    };
    const out = redactValue(payload) as typeof payload;
    expectClean(JSON.stringify(out));
    // Non-secret request metadata is preserved — otherwise the log is useless.
    expect(out.req.method).toBe('POST');
    expect(out.res.statusCode).toBe(200);
    expect(out.req.headers['content-type']).toBe('application/json');
  });

  it('blanks sensitive keys whose values have no shape at all', () => {
    const out = redactValue({
      authorization: 'opaque-value',
      cookie: 'a=b',
      password: 'p',
      secret: 'x',
      token: 'y',
      passphrase: 'z',
    }) as Record<string, string>;
    for (const v of Object.values(out)) expect(v).toBe('<redacted>');
  });

  it('does not blank lookalike keys that carry ordinary values', () => {
    const payload = {
      tokens: 4096,
      total_tokens: 1801,
      input_tokens: 1234,
      key: 'apn',
      code: 'TN',
      author: 'Tyler',
      keyword: 'zoning',
      tokenCount: 12,
    };
    expect(redactValue(payload)).toEqual(payload);
  });

  it('redacts below the depth cap instead of passing the value through', () => {
    // Build a chain deeper than MAX_DEPTH; the secret must not survive.
    let node: Record<string, unknown> = { leak: SYNTH_SHAPELESS };
    for (let i = 0; i < 20; i += 1) node = { next: node };
    expect(JSON.stringify(redactValue(node))).not.toContain(SYNTH_SHAPELESS);
  });

  it('breaks cycles without throwing', () => {
    const a: Record<string, unknown> = { name: 'a', secret: SYNTH_SHAPELESS };
    a.self = a;
    const out = redactValue(a) as Record<string, unknown>;
    expect(out.self).toBe('[Circular]');
    expect(out.secret).toBe('<redacted>');
  });

  it('breaks an indirect cycle', () => {
    const a: Record<string, unknown> = { name: 'a' };
    const b: Record<string, unknown> = { name: 'b', a };
    a.b = b;
    expect(() => redactValue(a)).not.toThrow();
    expect(JSON.stringify(redactValue(a))).toContain('[Circular]');
  });

  it('does not mistake a repeated reference for a cycle', () => {
    // The same object in two sibling fields is a DAG, not a cycle. Reporting
    // the second one as '[Circular]' would quietly corrupt ordinary logs —
    // agent records and config blobs get referenced twice all the time.
    const agent = { id: 'main', model: 'claude-opus-5' };
    const out = redactValue({ caller: agent, target: agent }) as {
      caller: unknown;
      target: unknown;
    };
    expect(out.caller).toEqual(agent);
    expect(out.target).toEqual(agent);
    expect(out.target).not.toBe('[Circular]');
  });

  it('does not mistake a repeated reference inside an array for a cycle', () => {
    const shared = { deal: 32 };
    const out = redactValue([shared, shared, shared]) as unknown[];
    expect(out).toEqual([shared, shared, shared]);
  });

  it('leaves scalars and exotic built-ins intact', () => {
    const date = new Date('2026-07-25T00:00:00.000Z');
    const map = new Map([['k', 'v']]);
    const set = new Set([1, 2]);
    const re = /abc/g;
    const buf = Buffer.from('hello');
    const out = redactValue({ date, map, set, re, buf, n: 42, b: true, z: null }) as Record<string, unknown>;
    expect(out.date).toBe(date);
    expect(out.map).toBe(map);
    expect(out.set).toBe(set);
    expect(out.re).toBe(re);
    expect(out.buf).toBe(buf);
    expect(out.n).toBe(42);
    expect(out.b).toBe(true);
    expect(out.z).toBeNull();
  });

  it('redacts a URL object rather than handing pino the credential', () => {
    const url = new URL(`http://localhost:3141/deals?token=${SYNTH_DASHBOARD}`);
    const out = redactValue(url) as string;
    expect(typeof out).toBe('string');
    expect(out).not.toContain(SYNTH_DASHBOARD);
  });

  it('leaves the server_startup event byte-identical', () => {
    // The managed runtime parses this exact line out of logs/main.log to prove
    // a process is really LandOS (scripts/runtime/landos-runtime.mjs). If
    // redaction ever rewrote cwd, port or pid, landos:status would go blind.
    const event = {
      event: 'server_startup',
      pid: 71864,
      agentId: 'main',
      cwd: 'C:\\Users\\operator\\claudeclaw-os',
      logFile: 'C:\\Users\\operator\\claudeclaw-os\\logs\\main.log',
      port: 3141,
    };
    expect(redactValue(event)).toEqual(event);
  });
});

// ── Errors ───────────────────────────────────────────────────────────

describe('redactValue — errors', () => {
  it('redacts the message and stack of an Error without mutating it', () => {
    const original = new Error(
      `request to https://api.telegram.org/bot${SYNTH_TELEGRAM}/getUpdates failed`,
    );
    const out = redactValue(original) as Error;
    expect(out).not.toBe(original);
    expect(out.message).not.toContain(SYNTH_TELEGRAM);
    expect(out.stack ?? '').not.toContain(SYNTH_TELEGRAM);
    // The live error the caller may still handle is untouched.
    expect(original.message).toContain(SYNTH_TELEGRAM);
  });

  it('redacts a stack that carries a secret in a frame', () => {
    const err = new Error('boom');
    err.stack = `Error: boom\n    at fetch (https://user:${SYNTH_SHAPELESS}@api.test/x:1:1)`;
    const out = redactValue(err) as Error;
    expect(out.stack).not.toContain(SYNTH_SHAPELESS);
  });

  it('redacts a nested error carried as `cause`', () => {
    const inner = new Error(`connect failed for ${SYNTH_SHAPELESS}`);
    const outer = new Error('provider init failed', { cause: inner });
    const out = redactValue(outer) as Error & { cause?: Error };
    expect(out.message).toBe('provider init failed');
    expect(out.cause).toBeDefined();
    expect((out.cause as Error).message).not.toContain(SYNTH_SHAPELESS);
  });

  it('redacts errors nested inside a payload object', () => {
    const payload = { stage: 'poll', err: new Error(`bad token ${SYNTH_DASHBOARD}`) };
    const out = redactValue(payload) as { stage: string; err: Error };
    expect(out.stage).toBe('poll');
    expect(out.err.message).not.toContain(SYNTH_DASHBOARD);
  });

  it('redacts extra enumerable properties hung off an error', () => {
    const err = Object.assign(new Error('http 401'), {
      request: { url: `https://api.test/v1?api_key=${SYNTH_SHAPELESS}` },
      status: 401,
    });
    const out = redactValue(err) as Error & { request: { url: string }; status: number };
    expect(out.request.url).not.toContain(SYNTH_SHAPELESS);
    expect(out.status).toBe(401);
  });

  it('redacts every branch of an AggregateError', () => {
    const agg = new AggregateError(
      [new Error(`a ${SYNTH_SHAPELESS}`), new Error(`b ${SYNTH_DB_KEY}`)],
      'all providers failed',
    );
    const out = redactValue(agg) as Error & { errors: Error[] };
    expect(out.errors).toHaveLength(2);
    expectClean(out.errors.map((e) => e.message).join(' '));
  });
});

// ── End-to-end through the real pino hook ────────────────────────────

describe('logger chokepoint', () => {
  /** Run the exact hook logger.ts installs, against a real pino instance. */
  function captureLog(fn: (l: pino.Logger) => void): string {
    const chunks: string[] = [];
    const sink = new Writable({
      write(chunk, _enc, cb) {
        chunks.push(chunk.toString());
        cb();
      },
    });
    const l = pino({ level: 'trace', hooks: { logMethod: redactingLogMethod } }, sink);
    fn(l);
    return chunks.join('');
  }

  it('strips a secret from the merging object', () => {
    const out = captureLog((l) => l.info({ botToken: SYNTH_TELEGRAM }, 'starting'));
    expectClean(out);
    expect(out).toContain('starting');
  });

  it('strips a secret from the message string', () => {
    const out = captureLog((l) => l.warn(`polling failed for ${SYNTH_SHAPELESS}`));
    expectClean(out);
    expect(out).toContain('polling failed for');
  });

  it('strips a secret from an interpolation argument', () => {
    const out = captureLog((l) => l.error('token %s rejected', SYNTH_DASHBOARD));
    expectClean(out);
  });

  it('strips a secret reaching the sink only via err.message', () => {
    // The original leak: nobody chose to log the token; node-fetch put it in
    // the message and `logger.error({ err })` carried it to disk.
    const err = new Error(
      `request to https://api.telegram.org/bot${SYNTH_TELEGRAM}/getUpdates failed`,
    );
    const out = captureLog((l) => l.error({ err }, 'Telegram polling error'));
    expectClean(out);
    expect(out).toContain('Telegram polling error');
  });

  it('keeps ordinary structured fields readable', () => {
    const out = captureLog((l) =>
      l.info({ event: 'server_startup', pid: 71864, port: 3141, cwd: 'C:\\Users\\operator\\claudeclaw-os' }, 'up'));
    expect(out).toContain('"event":"server_startup"');
    expect(out).toContain('"pid":71864');
    expect(out).toContain('"port":3141');
    expect(out).toContain('C:\\\\Users\\\\operator\\\\claudeclaw-os');
  });
});

// ── Wiring and drift guards ──────────────────────────────────────────

describe('redaction wiring', () => {
  const loggerSource = fs.readFileSync(path.resolve(__dirname, 'logger.ts'), 'utf-8');

  it('logger.ts installs the redacting hook on the exported pino logger', () => {
    expect(loggerSource).toContain('hooks: { logMethod: redactingLogMethod }');
    expect(loggerSource).toContain("from './log-redact.js'");
  });

  it('covers every env var name config.ts protects by default', () => {
    // Read the source rather than importing config.ts: importing it would run
    // its .env read, and this test must never touch a real secret.
    const configSource = fs.readFileSync(path.resolve(__dirname, 'config.ts'), 'utf-8');
    const match = configSource.match(
      /export const PROTECTED_ENV_VARS = \([\s\S]*?'([A-Z0-9_,]+)'\s*\)\.split/,
    );
    expect(match, 'PROTECTED_ENV_VARS default literal not found in config.ts').toBeTruthy();
    const configDefaults = (match as RegExpMatchArray)[1].split(',').map((s) => s.trim()).filter(Boolean);
    expect(configDefaults.length).toBeGreaterThan(0);
    for (const name of configDefaults) {
      expect(DEFAULT_PROTECTED_ENV_VARS).toContain(name);
    }
  });

  it('honors PROTECTED_ENV_VARS additions from the environment', () => {
    const prevNames = process.env.PROTECTED_ENV_VARS;
    const prevCustom = process.env.LANDOS_TEST_CUSTOM_SECRET;
    const prevFlag = process.env.LANDOS_DISABLE_DOTENV_FALLBACK;
    process.env.LANDOS_DISABLE_DOTENV_FALLBACK = '1';
    process.env.PROTECTED_ENV_VARS = 'LANDOS_TEST_CUSTOM_SECRET';
    process.env.LANDOS_TEST_CUSTOM_SECRET = SYNTH_SHAPELESS;
    try {
      setProtectedValueSource(null);
      refreshProtectedValues();
      expect(redactString(`custom ${SYNTH_SHAPELESS}`)).not.toContain(SYNTH_SHAPELESS);
    } finally {
      if (prevNames === undefined) delete process.env.PROTECTED_ENV_VARS;
      else process.env.PROTECTED_ENV_VARS = prevNames;
      if (prevCustom === undefined) delete process.env.LANDOS_TEST_CUSTOM_SECRET;
      else process.env.LANDOS_TEST_CUSTOM_SECRET = prevCustom;
      if (prevFlag === undefined) delete process.env.LANDOS_DISABLE_DOTENV_FALLBACK;
      else process.env.LANDOS_DISABLE_DOTENV_FALLBACK = prevFlag;
      setProtectedValueSource(null);
    }
  });
});
