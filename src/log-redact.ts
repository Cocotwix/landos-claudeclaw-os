/**
 * Secret redaction for anything on its way to a log sink.
 *
 * Why a chokepoint and not per-call-site sanitising: the highest-value leaks
 * are the ones nobody chose to log. `node-fetch` builds
 * "request to https://api.telegram.org/bot<TOKEN>/getUpdates failed, reason: ..."
 * and grammy propagates it verbatim, so a plain `logger.error({ err })` on the
 * polling path writes the bot token to `logs/main.log`. The same shape shows up
 * for dashboard tokens in `?token=` URLs, provider keys in Authorization
 * headers, and session cookies in request metadata. Patching one catch block
 * leaves the next one free to reintroduce it — so every log call routes through
 * here instead (see the `hooks.logMethod` chokepoint in logger.ts).
 *
 * Two independent layers:
 *   1. Shape rules — known credential formats (Telegram tokens, bearer values,
 *      sk-/ghp_/xox tokens, JWTs, userinfo URLs, sensitive query params).
 *   2. Registered values — the actual configured secrets named by
 *      PROTECTED_ENV_VARS, matched literally. This catches credentials that
 *      have no recognisable shape at all.
 * Plus key-based redaction for `authorization` / `cookie` / `password`-style
 * fields whose values carry no distinguishing shape.
 *
 * Deliberately conservative: it rewrites recognised credentials and never
 * guesses at anything else. Ordinary log content — Windows paths, ports, PIDs,
 * token *counts*, model ids, the `server_startup` event the managed runtime
 * parses — must pass through byte-identical. Anything unmatched still reaches
 * the log, so this is a safety net, not a licence to log secrets on purpose.
 *
 * Nothing here ever emits a secret: registered values are used only as search
 * needles and are replaced, never printed, returned, or logged.
 */

import { withEnvFileSecrets } from './env.js';

export const REDACTED = '<redacted>';

interface Rule {
  readonly name: string;
  readonly pattern: RegExp;
  readonly replace: string;
}

// Ordered most-specific first.
const RULES: readonly Rule[] = [
  {
    // Telegram bot tokens are <numeric-id>:<35-char secret> and leak inside
    // api.telegram.org URLs. The numeric id is kept: it identifies which bot
    // failed, which is the whole point of the log line, and is not a credential.
    name: 'telegram-bot-token-url',
    pattern: /(api\.telegram\.org\/bot)(\d+):[A-Za-z0-9_-]+/g,
    replace: `$1$2:${REDACTED}`,
  },
  {
    // Bare token outside a URL — grammy sometimes formats its own messages.
    name: 'telegram-bot-token-bare',
    pattern: /\b(\d{8,12}):(AA[A-Za-z0-9_-]{30,})\b/g,
    replace: `$1:${REDACTED}`,
  },
  {
    // Credentials embedded in a URL's userinfo section.
    name: 'url-userinfo',
    pattern: /(\b[a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^/\s@]+@/gi,
    replace: `$1${REDACTED}@`,
  },
  {
    // Sensitive query parameters, in URLs or in anything URL-shaped. The
    // dashboard passes its master token as `?token=`, so this is a live leak
    // path, not a hypothetical one. Deliberately excludes generic names like
    // `key` and `code` that routinely carry ordinary values.
    name: 'sensitive-query-param',
    pattern:
      /([?&](?:access[-_]?token|refresh[-_]?token|id[-_]?token|client[-_]?secret|api[-_]?key|apikey|authorization|auth|password|passwd|pwd|secret|signature|sig|token)=)([^&\s"'<>\\]+)/gi,
    replace: `$1${REDACTED}`,
  },
  {
    name: 'authorization-header-value',
    pattern: /\b(bearer|basic|token)\s+[A-Za-z0-9._~+/=-]{12,}/gi,
    replace: `$1 ${REDACTED}`,
  },
  {
    // Anthropic and OpenAI-style keys (sk-, sk-ant-, sk-proj-).
    name: 'sk-key',
    pattern: /\bsk-[A-Za-z0-9_-]{16,}/g,
    replace: REDACTED,
  },
  {
    name: 'github-token',
    pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
    replace: REDACTED,
  },
  {
    name: 'slack-token',
    pattern: /\bxox[bpsare]-[A-Za-z0-9-]{10,}/g,
    replace: REDACTED,
  },
  {
    name: 'google-api-key',
    pattern: /\bAIza[A-Za-z0-9_-]{30,}/g,
    replace: REDACTED,
  },
  {
    name: 'groq-key',
    pattern: /\bgsk_[A-Za-z0-9]{20,}/g,
    replace: REDACTED,
  },
  {
    name: 'aws-access-key',
    pattern: /\bAKIA[A-Z0-9]{16}\b/g,
    replace: REDACTED,
  },
  {
    name: 'jwt',
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
    replace: REDACTED,
  },
];

// ── Key-based redaction ──────────────────────────────────────────────
// Header, cookie and credential fields whose values have no recognisable
// shape: `{ headers: { authorization: 'abc123' } }` is a leak that no shape
// rule can catch. Names are normalised (lowercased, separators stripped) so
// `X-Api-Key`, `x_api_key` and `apiKey` all collapse to the same entry.
//
// Kept narrow on purpose. `tokens`, `total_tokens` and `input_tokens` do NOT
// normalise to `token`, so cost/usage telemetry is untouched. Bare `key`,
// `auth` and `code` are excluded — they carry ordinary values far too often.
const SENSITIVE_KEYS: ReadonlySet<string> = new Set([
  'authorization',
  'proxyauthorization',
  'wwwauthenticate',
  'cookie',
  'cookies',
  'setcookie',
  'xapikey',
  'apikey',
  'token',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'sessiontoken',
  'bottoken',
  'dashboardtoken',
  'bearertoken',
  'secret',
  'clientsecret',
  'password',
  'passwd',
  'pwd',
  'passphrase',
  'privatekey',
  'credential',
  'credentials',
]);

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[-_\s]/g, '');
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(normalizeKey(key));
}

// ── Registered secret values ─────────────────────────────────────────

/**
 * Default set of env var names whose VALUES must never reach a log sink.
 *
 * Mirrors the PROTECTED_ENV_VARS default in config.ts and adds the dashboard
 * and Slack bot credentials. Deliberately duplicated rather than imported:
 * logger.ts is imported by almost every module, and pulling config.ts into
 * that graph would run config's import-time .env read on any logger import.
 * `log-redact.test.ts` pins this list against config.ts so the two cannot
 * drift apart silently.
 */
export const DEFAULT_PROTECTED_ENV_VARS: readonly string[] = [
  'ANTHROPIC_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'DB_ENCRYPTION_KEY',
  'TELEGRAM_BOT_TOKEN',
  'SLACK_USER_TOKEN',
  'SLACK_BOT_TOKEN',
  'GROQ_API_KEY',
  'ELEVENLABS_API_KEY',
  'GOOGLE_API_KEY',
  'DASHBOARD_TOKEN',
  'OPENAI_API_KEY',
  'OPENROUTER_API_KEY',
  'APIFY_TOKEN',
  'DAILY_API_KEY',
  'DEEPGRAM_API_KEY',
  'CARTESIA_API_KEY',
];

/**
 * A value shorter than this is not treated as a redaction needle. Short
 * strings collide with ordinary log content, and blanking every occurrence of
 * a 6-character value would corrupt unrelated lines. Matches the existing
 * threshold in exfiltration-guard.ts.
 */
const MIN_NEEDLE_LENGTH = 9;

type ValueSource = () => string[];

let valueSource: ValueSource | null = null;
let cachedValues: string[] | null = null;

/**
 * Override where registered secret values come from. Tests use this to install
 * synthetic secrets; production leaves it null and reads the real config.
 * Passing null restores the default source and clears the cache.
 */
export function setProtectedValueSource(source: ValueSource | null): void {
  valueSource = source;
  cachedValues = null;
}

/** Drop the cached needle list (call after config changes). */
export function refreshProtectedValues(): void {
  cachedValues = null;
}

function defaultProtectedValues(): string[] {
  const names = (process.env.PROTECTED_ENV_VARS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const wanted = Array.from(new Set([...DEFAULT_PROTECTED_ENV_VARS, ...names]));
  // Secrets deliberately live in the .env FILE and are never loaded into
  // process.env (see env.ts), so process.env alone would find nothing.
  const env = withEnvFileSecrets(wanted, process.env);
  const values: string[] = [];
  for (const name of wanted) {
    const value = env[name];
    if (typeof value === 'string' && value.trim().length >= MIN_NEEDLE_LENGTH) {
      values.push(value.trim());
    }
  }
  // Longest first so a value that contains another is redacted whole.
  return values.sort((a, b) => b.length - a.length);
}

function protectedValues(): string[] {
  if (cachedValues === null) {
    try {
      cachedValues = (valueSource ?? defaultProtectedValues)();
    } catch {
      // Never let redaction setup break logging. Shape rules still apply.
      cachedValues = [];
    }
  }
  return cachedValues;
}

/** Literal replacement of every registered secret value. */
function redactRegisteredValues(input: string): string {
  const values = protectedValues();
  if (values.length === 0) return input;
  let out = input;
  for (const value of values) {
    if (out.length < value.length) continue;
    if (out.includes(value)) out = out.split(value).join(REDACTED);
  }
  return out;
}

// ── Public API ───────────────────────────────────────────────────────

/** Rewrite every registered secret value and known credential shape. */
export function redactString(input: string): string {
  // Registered values first: a literal match is authoritative, and doing it
  // before the shape rules stops a partially-rewritten token from surviving.
  let out = redactRegisteredValues(input);
  for (const rule of RULES) {
    rule.pattern.lastIndex = 0;
    out = out.replace(rule.pattern, rule.replace);
  }
  return out;
}

/** True when the string still carries something that looks like a credential. */
export function hasSecret(input: string): boolean {
  if (protectedValues().some((v) => input.includes(v))) return true;
  return RULES.some((r) => {
    r.pattern.lastIndex = 0;
    return r.pattern.test(input);
  });
}

/**
 * Depth cap. Beyond this the value is serialised and redacted as one string
 * rather than returned untouched — a depth limit must not become a way for a
 * deeply nested secret to reach the sink unredacted.
 */
const MAX_DEPTH = 12;

function redactDeepLeaf(value: unknown): unknown {
  try {
    const json = JSON.stringify(value);
    return json === undefined ? String(value) : redactString(json);
  } catch {
    return '[Unserializable]';
  }
}

function cloneError(value: Error, depth: number, seen: WeakSet<object>): Error {
  // Copy rather than mutate: the caller may still handle this error, and
  // rewriting the message on a live object is a nasty surprise downstream.
  const clone = new Error(redactString(value.message));
  clone.name = value.name;
  if (value.stack) clone.stack = redactString(value.stack);
  // `cause` is a non-enumerable own property, so Object.entries misses it —
  // and a wrapped fetch error is exactly where the token tends to hide.
  if ('cause' in value && (value as { cause?: unknown }).cause !== undefined) {
    Object.defineProperty(clone, 'cause', {
      value: redactValue((value as { cause?: unknown }).cause, depth + 1, seen),
      writable: true,
      configurable: true,
      enumerable: false,
    });
  }
  const aggregate = (value as unknown as { errors?: unknown }).errors;
  if (Array.isArray(aggregate)) {
    (clone as unknown as Record<string, unknown>).errors = aggregate.map((e) =>
      redactValue(e, depth + 1, seen),
    );
  }
  for (const [k, v] of Object.entries(value)) {
    (clone as unknown as Record<string, unknown>)[k] = redactValue(v, depth + 1, seen);
  }
  return clone;
}

/**
 * Deep-redact an arbitrary log payload. Strings are rewritten, Errors are
 * rebuilt with a clean message/stack/cause, sensitive field names are blanked
 * by key, and cycles are broken. Non-string leaves (numbers, booleans) pass
 * through untouched.
 */
export function redactValue(
  value: unknown,
  depth = 0,
  seen: WeakSet<object> = new WeakSet<object>(),
): unknown {
  if (typeof value === 'string') return redactString(value);
  if (value === null || typeof value !== 'object') return value;

  const obj = value as object;
  // `seen` tracks the ANCESTOR CHAIN, not everything ever visited, and each
  // node is removed again on the way out. A payload that legitimately
  // references the same object twice side by side (the same agent record in
  // two fields, say) is not a cycle, and reporting the second one as
  // '[Circular]' would quietly corrupt ordinary log content.
  if (seen.has(obj)) return '[Circular]';
  if (depth >= MAX_DEPTH) return redactDeepLeaf(value);
  seen.add(obj);
  try {
    if (value instanceof Error) return cloneError(value, depth, seen);

    if (Array.isArray(value)) return value.map((v) => redactValue(v, depth + 1, seen));

    // Exotic built-ins carry their state outside enumerable own properties, so
    // rebuilding them from Object.entries() silently destroys them — a Date came
    // back as {} and would have wiped every timestamp in the logs. Treat them as
    // leaves: pino's own serializers know what to do with these.
    if (
      value instanceof Date
      || value instanceof RegExp
      || value instanceof Map
      || value instanceof Set
      || value instanceof URL
      || ArrayBuffer.isView(value)
      || value instanceof ArrayBuffer
    ) {
      // A URL is the one exotic type that routinely carries a credential, and
      // pino stringifies it — so hand back the redacted href instead.
      if (value instanceof URL) return redactString(value.href);
      return value;
    }

    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveKey(k) && typeof v === 'string') {
        // Blank the whole value: an Authorization header or a raw cookie jar has
        // no non-secret part worth preserving.
        out[k] = v.length === 0 ? v : REDACTED;
        continue;
      }
      out[k] = redactValue(v, depth + 1, seen);
    }
    return out;
  } finally {
    seen.delete(obj);
  }
}
