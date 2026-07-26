/**
 * Failure-classification regression suite.
 *
 * The defect being pinned: the previous classifier read the exit code first, so
 * an expired provider login — which the Claude Code SDK surfaces as
 * "exited with code 1" plus auth text on stderr — was recorded as
 * `subprocess_crash` and retried. Operators chased an application defect that
 * did not exist while the real fix was `claude login`.
 *
 * Every case here is synthetic: no provider is contacted and no subprocess is
 * spawned.
 */

import { describe, it, expect } from 'vitest';

import { classifyExecution, formatOutcome, type FailureCategory } from './failure-classification.js';
import { classifyError } from './errors.js';
import { setProtectedValueSource } from './log-redact.js';

/** Shorthand: what category does this signal set resolve to? */
function categoryOf(signals: Parameters<typeof classifyExecution>[0]): FailureCategory {
  return classifyExecution(signals).category;
}

describe('classifyExecution — provider meaning outranks the exit code', () => {
  it('classifies an expired login as auth, NOT a crash, even on a non-zero exit', () => {
    const outcome = classifyExecution({
      exitCode: 1,
      stderr: 'API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}',
    });
    expect(outcome.category).toBe('auth');
    expect(outcome.retryable, 'retrying a rejected credential can never succeed').toBe(false);
    expect(outcome.operatorActionRequired).toBe(true);
    expect(outcome.message).toContain('claude login');
    expect(outcome.message).toContain('not an application defect');
  });

  it('classifies a missing credential distinctly from a rejected one', () => {
    expect(categoryOf({ exitCode: 1, stderr: 'ANTHROPIC_API_KEY is not set. Please run `claude login`.' }))
      .toBe('credentials_missing');
    expect(categoryOf({ exitCode: 1, stderr: 'Invalid API key provided' }))
      .toBe('auth');
  });

  it('classifies a 403 as auth rather than a crash', () => {
    expect(categoryOf({ exitCode: 2, stderr: 'Request failed with status code 403: Forbidden' })).toBe('auth');
  });

  it('classifies quota exhaustion as quota, not rate_limit and not a crash', () => {
    const outcome = classifyExecution({
      exitCode: 1,
      stderr: 'Your credit balance is too low to access the API. 402 Payment Required',
    });
    expect(outcome.category).toBe('quota');
    expect(outcome.retryable).toBe(false);
    expect(outcome.operatorActionRequired).toBe(true);
  });

  it('classifies throttling as rate_limit and keeps it retryable', () => {
    const outcome = classifyExecution({ exitCode: 1, stderr: 'HTTP 429 Too Many Requests; retry-after: 30' });
    expect(outcome.category).toBe('rate_limit');
    expect(outcome.retryable).toBe(true);
    expect(outcome.operatorActionRequired).toBe(false);
  });

  it('classifies provider unavailability separately from a network failure', () => {
    expect(categoryOf({ exitCode: 1, stderr: 'Error 529: Overloaded' })).toBe('provider_unavailable');
    expect(categoryOf({ exitCode: 1, stderr: 'status 503 Service Unavailable' })).toBe('provider_unavailable');
    expect(categoryOf({ error: new Error('getaddrinfo ENOTFOUND api.anthropic.com') })).toBe('network');
    expect(categoryOf({ error: new Error('connect ECONNREFUSED 127.0.0.1:443') })).toBe('network');
  });

  it('does not read a bare number in prose as an HTTP status', () => {
    // "500 parcels" must not become provider_unavailable.
    expect(categoryOf({ exitCode: 1, stderr: 'Processed 500 parcels then stopped' })).toBe('crash');
  });
});

describe('classifyExecution — process lifecycle', () => {
  it('classifies a spawn errno as launch_failure, not a crash', () => {
    const outcome = classifyExecution({ spawnErrorCode: 'ENOENT', error: new Error('spawn claude ENOENT') });
    expect(outcome.category).toBe('launch_failure');
    expect(outcome.retryable, 'a missing binary is still missing on the next attempt').toBe(false);
    expect(outcome.operatorActionRequired).toBe(true);
  });

  it('classifies a non-executable binary as launch_failure', () => {
    expect(categoryOf({ spawnErrorCode: 'EACCES', error: new Error("EACCES: permission denied, open '/usr/local/bin/claude'") }))
      .toBe('launch_failure');
  });

  it('classifies a Windows "not recognized" message as launch_failure', () => {
    expect(categoryOf({ exitCode: 1, stderr: "'claude' is not recognized as an internal or external command" }))
      .toBe('launch_failure');
  });

  it('classifies an unexplained non-zero exit as a crash', () => {
    const outcome = classifyExecution({ exitCode: 1, stderr: 'Segmentation fault' });
    expect(outcome.category).toBe('crash');
    expect(outcome.detail).toContain('exit code 1');
  });

  it('classifies a killing signal as a crash and names the signal', () => {
    const outcome = classifyExecution({ signal: 'SIGKILL' });
    expect(outcome.category).toBe('crash');
    expect(outcome.detail).toContain('SIGKILL');
  });

  it('classifies an explicit timeout as timeout, never a crash', () => {
    const outcome = classifyExecution({ timedOut: true, exitCode: 143, signal: 'SIGTERM' });
    expect(outcome.category).toBe('timeout');
    expect(outcome.retryable).toBe(true);
  });

  it('classifies an operator cancellation as cancelled, never a crash', () => {
    const outcome = classifyExecution({
      cancelledByUser: true,
      exitCode: 1,
      stderr: 'write EPIPE\nsegmentation fault',
    });
    expect(outcome.category).toBe('cancelled');
    expect(outcome.retryable).toBe(false);
    expect(outcome.operatorActionRequired).toBe(false);
  });

  it('classifies an unattributed abort as timeout, since that is the only clock LandOS runs', () => {
    expect(categoryOf({ aborted: true })).toBe('timeout');
  });
});

describe('classifyExecution — success and empty output', () => {
  it('classifies a clean exit with output as success', () => {
    const outcome = classifyExecution({ exitCode: 0, output: 'Here is the report.', requireOutput: true });
    expect(outcome.category).toBe('success');
    expect(outcome.ok).toBe(true);
  });

  it('classifies a clean exit with blank output as invalid_output, not success', () => {
    const outcome = classifyExecution({ exitCode: 0, output: '   \n ', requireOutput: true });
    expect(outcome.category).toBe('invalid_output');
    expect(outcome.ok).toBe(false);
    expect(outcome.retryable).toBe(true);
  });

  it('does not demand output when the caller did not ask for it', () => {
    expect(categoryOf({ exitCode: 0, output: null })).toBe('success');
  });

  it('classifies context exhaustion distinctly', () => {
    expect(categoryOf({ exitCode: 1, stderr: 'prompt is too long: 250000 tokens > 200000 maximum' }))
      .toBe('context_exhausted');
  });

  it('reports an unmatched thrown error as unknown rather than inventing a crash', () => {
    const outcome = classifyExecution({ error: new Error('something nobody has ever seen') });
    expect(outcome.category).toBe('unknown');
  });
});

describe('classifyExecution — every taxonomy entry is distinguishable', () => {
  // One synthetic case per category; each must land on its own category and no
  // two may collide. This is the guard against the old collapse-everything-
  // into-crash behaviour creeping back.
  const CASES: Array<[FailureCategory, Parameters<typeof classifyExecution>[0]]> = [
    ['success', { exitCode: 0, output: 'done', requireOutput: true }],
    ['invalid_output', { exitCode: 0, output: '', requireOutput: true }],
    ['auth', { exitCode: 1, stderr: 'authentication_error: invalid api key' }],
    ['credentials_missing', { exitCode: 1, stderr: 'no api key found in environment' }],
    ['quota', { exitCode: 1, stderr: 'quota exceeded for this organization' }],
    ['rate_limit', { exitCode: 1, stderr: 'rate limit reached, too many requests' }],
    ['provider_unavailable', { exitCode: 1, stderr: 'upstream connect error: overloaded' }],
    ['network', { exitCode: 1, stderr: 'fetch failed: ECONNRESET' }],
    ['launch_failure', { spawnErrorCode: 'ENOENT' }],
    ['crash', { exitCode: 139, stderr: 'core dumped' }],
    ['timeout', { timedOut: true }],
    ['cancelled', { cancelledByUser: true }],
    ['context_exhausted', { exitCode: 1, stderr: 'context window exceeded' }],
    ['unknown', { error: new Error('inexplicable') }],
  ];

  for (const [expected, signals] of CASES) {
    it(`resolves ${expected}`, () => {
      expect(categoryOf(signals)).toBe(expected);
    });
  }

  it('produces 14 distinct categories across the case table', () => {
    const seen = new Set(CASES.map(([, s]) => categoryOf(s)));
    expect(seen.size).toBe(CASES.length);
  });
});

describe('classified failures never leak credentials', () => {
  it('redacts an api key that appears in stderr', () => {
    // SYNTHETIC fixture, not a credential. Assembled at runtime so a secret
    // scanner never sees a key-shaped literal in this file, while the
    // classifier still receives the real shape it has to redact.
    const fakeKey = ['sk', 'ant', 'api03', 'NOTAREALKEYNOTAREALKEYNOTAREAL'].join('-');
    const outcome = classifyExecution({
      exitCode: 1,
      stderr: `auth failed for key ${fakeKey}`,
    });
    expect(outcome.category).toBe('auth');
    expect(outcome.detail).not.toContain(fakeKey);
    expect(outcome.detail).toContain('<redacted>');
    expect(formatOutcome(outcome)).not.toContain('NOTAREALKEY');
  });

  it('redacts an authenticated URL', () => {
    const outcome = classifyExecution({
      exitCode: 1,
      error: new Error('request to https://svc:hunter2@internal.example/api?access_token=abcdef123456 failed: unauthorized'),
    });
    expect(outcome.detail).not.toContain('hunter2');
    expect(outcome.detail).not.toContain('abcdef123456');
  });

  it('redacts a bearer header echoed by a provider', () => {
    const outcome = classifyExecution({
      exitCode: 1,
      stderr: 'Request headers: Authorization: Bearer eyJhbGciOi.QQQQQQQQQQ.RRRRRRRRRR — 401 unauthorized',
    });
    expect(outcome.detail).not.toContain('eyJhbGciOi.QQQQQQQQQQ.RRRRRRRRRR');
  });

  it('redacts a registered env secret value', () => {
    setProtectedValueSource(() => ['landos-super-secret-value-123']);
    try {
      const outcome = classifyExecution({
        exitCode: 1,
        stderr: 'login rejected using landos-super-secret-value-123',
      });
      expect(outcome.detail).not.toContain('landos-super-secret-value-123');
      expect(outcome.detail).toContain('<redacted>');
    } finally {
      setProtectedValueSource(null);
    }
  });

  it('bounds the detail length so a huge stderr cannot flood the store', () => {
    const outcome = classifyExecution({ exitCode: 1, stderr: 'x'.repeat(50_000) });
    expect((outcome.detail ?? '').length).toBeLessThanOrEqual(500);
  });
});

describe('classifyError keeps its recovery policy while using the corrected order', () => {
  it('no longer calls an authenticated-failure exit a subprocess crash', () => {
    const err = new Error('Claude Code process exited with code 1: invalid api key');
    const classified = classifyError(err);
    expect(classified.category).toBe('auth');
    expect(classified.recovery.shouldRetry).toBe(false);
    expect(classified.outcome?.category).toBe('auth');
  });

  it('still calls a bare non-zero exit a subprocess crash', () => {
    const classified = classifyError(new Error('Process exited with code 1'));
    expect(classified.category).toBe('subprocess_crash');
    expect(classified.recovery.shouldRetry).toBe(true);
    expect(classified.outcome?.category).toBe('crash');
  });

  it('marks a launch failure as non-retryable so it cannot burn the retry budget', () => {
    const classified = classifyError(new Error('spawn claude ENOENT'));
    expect(classified.category).toBe('launch_failure');
    expect(classified.recovery.shouldRetry).toBe(false);
  });

  it('attaches the structured outcome for persistence', () => {
    const classified = classifyError(new Error('429 too many requests'));
    expect(classified.category).toBe('rate_limit');
    expect(classified.outcome?.category).toBe('rate_limit');
    expect(classified.outcome?.retryable).toBe(true);
  });
});
