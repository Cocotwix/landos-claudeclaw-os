/**
 * Execution failure taxonomy for LandOS provider and subprocess runs.
 *
 * WHY THIS EXISTS: the previous behaviour collapsed almost every provider
 * problem into "subprocess crashed". `classifyError` matched
 * `exited with code 1` BEFORE it looked at the message text, and the Claude
 * Code SDK reports an expired login as exactly that — a non-zero exit whose
 * stderr says "invalid api key". Operators saw "Claude Code subprocess
 * crashed. Retrying..." and went looking for an application defect, while the
 * real fix was `claude login`. Worse, the crash branch is retryable, so LandOS
 * burned three attempts against a credential that could never succeed.
 *
 * The rule this module encodes: an exit code tells you THAT a process ended,
 * never WHY. Provider semantics in the message/stderr are authoritative and are
 * matched first; the exit code is only the fallback once no provider meaning is
 * present.
 *
 * Everything that leaves this module passes through `redactString`, so a
 * classified failure can be persisted, shown on the dashboard, printed by a CLI
 * or sent to Telegram without leaking a key, token, cookie or authenticated URL.
 */

import { redactString } from './log-redact.js';

export type FailureCategory =
  /** Process finished and produced usable output. */
  | 'success'
  /** Process finished cleanly but the output is missing or unusable. */
  | 'invalid_output'
  /** Provider rejected the identity: expired login, bad key, forbidden. */
  | 'auth'
  /** No credential was configured at all, or it is structurally invalid. */
  | 'credentials_missing'
  /** Account-level exhaustion: credits, billing, hard quota. */
  | 'quota'
  /** Temporary throttling: 429, requests-per-minute. */
  | 'rate_limit'
  /** Provider reachable but refusing work: 500/502/503/529, overloaded. */
  | 'provider_unavailable'
  /** Could not reach the provider: DNS, refused, reset, TLS. */
  | 'network'
  /** The process never started: binary missing, not executable. */
  | 'launch_failure'
  /** The process started and died abnormally: signal or unexplained non-zero exit. */
  | 'crash'
  /** Wall-clock limit hit. */
  | 'timeout'
  /** An operator (or the dashboard) stopped it deliberately. */
  | 'cancelled'
  /** Model ran out of usable context. */
  | 'context_exhausted'
  /** Genuinely unrecognised. Never used as a catch-all for the categories above. */
  | 'unknown';

export interface ExecutionOutcome {
  category: FailureCategory;
  /** True only for `success`. */
  ok: boolean;
  /** Whether retrying the same call could plausibly succeed. */
  retryable: boolean;
  /** Whether an operator must change configuration or credentials first. */
  operatorActionRequired: boolean;
  /** One-line operator-facing explanation. Redacted. */
  message: string;
  /** Redacted excerpt of the underlying evidence, when there is any. */
  detail?: string;
}

export interface ExecutionSignals {
  /** Operator/dashboard cancellation. Outranks every other signal. */
  cancelledByUser?: boolean;
  /** Wall-clock limit was hit by the caller. */
  timedOut?: boolean;
  /** AbortController fired for a reason the caller did not attribute. */
  aborted?: boolean;
  /** Exit code, when the caller ran a subprocess. */
  exitCode?: number | null;
  /** Terminating signal (SIGKILL, SIGSEGV, ...). */
  signal?: string | null;
  /** errno-style code from a failed spawn (ENOENT, EACCES, ...). */
  spawnErrorCode?: string | null;
  stderr?: string | null;
  /** The thrown error, if the caller has one. */
  error?: unknown;
  /** Text the run produced. */
  output?: string | null;
  /** When true, a clean exit with blank output is `invalid_output`, not success. */
  requireOutput?: boolean;
}

// ── Pattern tables ──────────────────────────────────────────────────
//
// Applied in the precedence order set out in classifyExecution(). Kept as
// lowercase substrings; the subject text is lowercased once up front.

/**
 * The process never started. Checked BEFORE the auth table on purpose: a bare
 * `EACCES: permission denied` is a file-permission problem on the binary, and
 * "permission denied" also appears in the auth table.
 */
const LAUNCH_FAILURE_PATTERNS = [
  'enoent',
  'eacces',
  'eperm',
  'enoexec',
  'command not found',
  'not found on path',
  'is not recognized as an internal or external command',
  'no such file or directory',
  'cannot execute binary',
  'exec format error',
  'spawn failed',
];

const CANCELLED_PATTERNS = [
  'cancelled by user',
  'canceled by user',
  'aborted by user',
  'user cancelled',
  'user canceled',
  'operation cancelled',
];

/**
 * Nothing to authenticate WITH, as opposed to a credential the provider
 * rejected. Checked before the auth table: "no api key" also contains
 * "api key", and "run `claude login`" also reads as auth.
 */
const CREDENTIALS_MISSING_PATTERNS = [
  'no api key',
  'api key not found',
  'api key is missing',
  'missing api key',
  'api key not configured',
  'anthropic_api_key is not set',
  'no credentials',
  'credentials not found',
  'missing credentials',
  'not logged in',
  'login required',
  'claude login',
  'please log in',
  'no auth token',
];

const AUTH_PATTERNS = [
  'authentication',
  'authentication_error',
  'auth failed',
  'authorization failed',
  'authentication failed',
  'unauthorized',
  'unauthenticated',
  'invalid api key',
  'invalid x-api-key',
  'invalid_api_key',
  'invalid token',
  'token expired',
  'expired token',
  'session expired',
  'oauth',
  'invalid_grant',
  'permission denied',
  'forbidden',
  'access denied',
];

const QUOTA_PATTERNS = [
  'insufficient credits',
  'credits exhausted',
  'credit balance',
  'payment required',
  'billing',
  'quota exceeded',
  'quota_exceeded',
  'exceeded your quota',
  'usage limit',
  'spend limit',
];

const RATE_LIMIT_PATTERNS = [
  'rate limit',
  'rate_limit',
  'ratelimit',
  'too many requests',
  'throttled',
  'requests per minute',
  'retry-after',
];

const PROVIDER_UNAVAILABLE_PATTERNS = [
  'overloaded',
  'service unavailable',
  'temporarily unavailable',
  'internal server error',
  'bad gateway',
  'at capacity',
  'upstream connect error',
];

const NETWORK_PATTERNS = [
  'enotfound',
  'econnrefused',
  'econnreset',
  'ehostunreach',
  'enetunreach',
  'eai_again',
  'epipe',
  'etimedout',
  'socket hang up',
  'network error',
  'getaddrinfo',
  'dns',
  'fetch failed',
  'certificate',
  'self signed',
  'unable to verify the first certificate',
];

const TIMEOUT_PATTERNS = [
  'timed out',
  'timeout',
  'deadline exceeded',
  'operation was aborted',
];

const CONTEXT_PATTERNS = [
  'context length',
  'context window',
  'prompt is too long',
  'maximum tokens',
  'max input tokens',
  'token limit',
];

/**
 * HTTP status codes, matched only in an explicit status context so a bare
 * number in prose (e.g. "500 parcels") cannot be read as a server error.
 */
const STATUS_RULES: ReadonlyArray<{ re: RegExp; category: FailureCategory }> = [
  { re: /(?:status|http|code|error)\D{0,12}\b401\b/i, category: 'auth' },
  { re: /(?:status|http|code|error)\D{0,12}\b403\b/i, category: 'auth' },
  { re: /(?:status|http|code|error)\D{0,12}\b402\b/i, category: 'quota' },
  { re: /(?:status|http|code|error)\D{0,12}\b429\b/i, category: 'rate_limit' },
  { re: /(?:status|http|code|error)\D{0,12}\b5(?:00|02|03|29)\b/i, category: 'provider_unavailable' },
];

/** errno codes that mean the binary never ran, as opposed to ran-and-died. */
const LAUNCH_ERRNOS = new Set(['ENOENT', 'EACCES', 'EPERM', 'ENOEXEC', 'E2BIG', 'EINVAL']);

function matchesAny(text: string, patterns: readonly string[]): boolean {
  return patterns.some((p) => text.includes(p));
}

function errorText(err: unknown, depth = 0): string {
  if (!err || depth > 4) return '';
  if (err instanceof Error) {
    const cause = (err as { cause?: unknown }).cause;
    const causeText = cause ? ` ${errorText(cause, depth + 1)}` : '';
    return `${err.message}${causeText}`;
  }
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/** Max characters of evidence carried on an outcome. Keeps DB rows and messages bounded. */
const DETAIL_LIMIT = 500;

function buildDetail(parts: Array<string | null | undefined>): string | undefined {
  const joined = parts
    .map((p) => (p ?? '').trim())
    .filter((p) => p.length > 0)
    .join(' | ');
  if (!joined) return undefined;
  // Redact BEFORE truncating, so a secret can never be split across the cut and
  // survive as a partial value.
  return redactString(joined).slice(0, DETAIL_LIMIT);
}

interface Verdict {
  retryable: boolean;
  operatorActionRequired: boolean;
  message: string;
}

const VERDICTS: Record<FailureCategory, Verdict> = {
  success: { retryable: false, operatorActionRequired: false, message: 'Completed successfully.' },
  invalid_output: {
    retryable: true,
    operatorActionRequired: false,
    message: 'The run finished without an error but produced no usable output.',
  },
  auth: {
    retryable: false,
    operatorActionRequired: true,
    message: 'Provider authentication failed. Re-authenticate the provider (for Claude: run `claude login`). This is a credential problem, not an application defect.',
  },
  credentials_missing: {
    retryable: false,
    operatorActionRequired: true,
    message: 'No usable provider credential is configured. Add or repair the credential, then restart.',
  },
  quota: {
    retryable: false,
    operatorActionRequired: true,
    message: 'Provider quota or billing is exhausted. Top up the account or switch provider.',
  },
  rate_limit: {
    retryable: true,
    operatorActionRequired: false,
    message: 'Provider rate limit hit. Backing off before retry.',
  },
  provider_unavailable: {
    retryable: true,
    operatorActionRequired: false,
    message: 'Provider is unavailable or overloaded. Backing off before retry.',
  },
  network: {
    retryable: true,
    operatorActionRequired: false,
    message: 'Could not reach the provider (network or DNS). Backing off before retry.',
  },
  launch_failure: {
    retryable: false,
    operatorActionRequired: true,
    message: 'The provider process could not be started. Check that the CLI is installed and on PATH for the LandOS service.',
  },
  crash: {
    retryable: true,
    operatorActionRequired: false,
    message: 'The provider process started and exited abnormally.',
  },
  timeout: {
    retryable: true,
    operatorActionRequired: false,
    message: 'The run exceeded its time limit and was stopped.',
  },
  cancelled: {
    retryable: false,
    operatorActionRequired: false,
    message: 'Cancelled by an operator.',
  },
  context_exhausted: {
    retryable: false,
    operatorActionRequired: true,
    message: 'The model ran out of usable context. Start a fresh session.',
  },
  unknown: {
    retryable: false,
    operatorActionRequired: true,
    message: 'The run failed for an unrecognised reason. Check the logs.',
  },
};

function outcome(category: FailureCategory, detail?: string): ExecutionOutcome {
  const verdict = VERDICTS[category];
  const result: ExecutionOutcome = {
    category,
    ok: category === 'success',
    retryable: verdict.retryable,
    operatorActionRequired: verdict.operatorActionRequired,
    message: verdict.message,
  };
  if (detail) result.detail = detail;
  return result;
}

/**
 * Classify one execution attempt.
 *
 * Precedence, highest first:
 *   1. explicit operator cancellation
 *   2. explicit timeout
 *   3. spawn errno — the process never started
 *   4. provider semantics in the message/stderr
 *   5. signal or non-zero exit with no provider meaning — a real crash
 *   6. clean exit with unusable output
 *   7. clean exit — success
 *
 * Step 4 sitting above step 5 is the whole point: it is what stops an expired
 * login from being reported as a crashed subprocess.
 */
export function classifyExecution(signals: ExecutionSignals): ExecutionOutcome {
  const detail = buildDetail([errorText(signals.error), signals.stderr]);
  const raw = `${errorText(signals.error)} ${signals.stderr ?? ''}`;
  const text = raw.toLowerCase();

  // 1. Explicit cancellation. Outranks everything — a cancelled run's stderr is
  //    frequently a torn-off write that reads like a crash.
  if (signals.cancelledByUser) return outcome('cancelled', detail);

  // 2. Explicit timeout from the caller's own clock.
  if (signals.timedOut) return outcome('timeout', detail);

  // 3. The process never started. An errno from spawn is unambiguous.
  if (signals.spawnErrorCode && LAUNCH_ERRNOS.has(signals.spawnErrorCode.toUpperCase())) {
    return outcome('launch_failure', detail);
  }

  // 4. Provider semantics. Checked BEFORE any exit-code reasoning.
  if (text.trim()) {
    if (matchesAny(text, LAUNCH_FAILURE_PATTERNS)) return outcome('launch_failure', detail);
    if (matchesAny(text, CANCELLED_PATTERNS)) return outcome('cancelled', detail);
    if (matchesAny(text, CREDENTIALS_MISSING_PATTERNS)) return outcome('credentials_missing', detail);
    if (matchesAny(text, AUTH_PATTERNS)) return outcome('auth', detail);
    // Quota before rate limit: exhausted credit is an account state retrying
    // cannot clear, while a 429 is transient.
    if (matchesAny(text, QUOTA_PATTERNS)) return outcome('quota', detail);
    if (matchesAny(text, RATE_LIMIT_PATTERNS)) return outcome('rate_limit', detail);
    if (matchesAny(text, CONTEXT_PATTERNS)) return outcome('context_exhausted', detail);
    if (matchesAny(text, PROVIDER_UNAVAILABLE_PATTERNS)) return outcome('provider_unavailable', detail);
    if (matchesAny(text, NETWORK_PATTERNS)) return outcome('network', detail);
    if (matchesAny(text, TIMEOUT_PATTERNS)) return outcome('timeout', detail);
    for (const rule of STATUS_RULES) {
      if (rule.re.test(raw)) return outcome(rule.category, detail);
    }
  }

  // 2b. An abort with no attributed reason and no provider meaning is a
  //     timeout: the only unattributed aborts LandOS raises come from its own
  //     task clock.
  if (signals.aborted) return outcome('timeout', detail);

  // 5. Died abnormally with nothing explaining why. Now, and only now, is
  //    "crash" the honest answer.
  if (signals.signal) return outcome('crash', buildDetail([`terminated by ${signals.signal}`, detail]));
  if (typeof signals.exitCode === 'number' && signals.exitCode !== 0) {
    return outcome('crash', buildDetail([`exit code ${signals.exitCode}`, detail]));
  }

  // An error was thrown but nothing above matched and the process reported no
  // abnormal exit. Report it as unknown rather than pretending it crashed.
  if (signals.error) return outcome('unknown', detail);

  // 6. Clean exit, unusable output.
  if (signals.requireOutput && !(signals.output ?? '').trim()) {
    return outcome('invalid_output', detail);
  }

  // 7. Clean exit.
  return outcome('success');
}

/**
 * Render a classified outcome as a single redacted operator-facing line,
 * suitable for a DB column, a CLI, the dashboard or Telegram.
 */
export function formatOutcome(result: ExecutionOutcome): string {
  const base = `[${result.category}] ${result.message}`;
  return result.detail ? `${base} — ${result.detail}` : base;
}
