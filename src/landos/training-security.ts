// Browser Training Department — security + redaction guard.
//
// Deterministic, dependency-free, and unit-tested. This runs BEFORE anything is
// stored or sent to the realtime model. It has two jobs:
//
//   1. Redact secrets so they are never recorded or transmitted (passwords,
//      .env, cookies, auth headers, tokens, local/sessionStorage, billing).
//   2. Detect prohibited / paid actions and force an "Approval Required" stop so
//      LandOS never auto-purchases anything.
//
// Allowed: login, property search, parcel selection, map search, visible data
// extraction, screenshots, Deal Card population.

export const REDACTED = '[redacted]';

// URL path/host fragments that indicate a billing, payment, or paid-action page.
// Matching any of these stops the session and marks Approval Required.
const PAID_URL_PATTERNS: RegExp[] = [
  /\/checkout/i,
  /\/billing/i,
  /\/payment/i,
  /\/subscribe/i,
  /\/subscription/i,
  /\/upgrade/i,
  /\/pricing/i,
  /\/purchase/i,
  /\/buy(-|\/|\?|$)/i,
  /\/cart/i,
  /\/order/i,
  /\/skip-?trace/i,
  /\/account\/(settings|billing|plan)/i,
  /stripe\.com/i,
  /checkout\.stripe/i,
  /paypal\.com\/(checkout|pay)/i,
];

// Visible text on a control (button label, link text) that indicates a paid
// action. Kept deliberately specific so ordinary words ("search", "select",
// "next parcel") never trip it.
const PAID_ACTION_PATTERNS: RegExp[] = [
  /\bbuy\b/i,
  /\bpurchase\b/i,
  /\bcheckout\b/i,
  /\bplace order\b/i,
  /\bpay\b/i,
  /\bconfirm (payment|purchase|order)\b/i,
  /\bunlock report\b/i,
  /\bpurchase report\b/i,
  /\bbuy (report|comps?|sold)\b/i,
  /\bskip ?trace\b/i,
  /\bsubscribe\b/i,
  /\bupgrade (plan|account|now)\b/i,
  /\bstart (free )?trial\b/i,
  /\badd payment\b/i,
  /\benter card\b/i,
];

// Sensitive DOM/storage surfaces that must never be captured verbatim.
const SENSITIVE_INPUT_TYPES = new Set(['password']);
const SENSITIVE_FIELD_NAME = /(pass(word|wd)?|secret|token|api[_-]?key|cvv|card ?number|ssn|routing|account ?number|otp|auth)/i;

// String patterns that look like leaked secrets (env dumps, headers, tokens).
const SECRET_LINE_PATTERNS: RegExp[] = [
  /\b(LANDPORTAL_PASSWORD|LANDPORTAL_EMAIL|[A-Z0-9_]*API_KEY|[A-Z0-9_]*SECRET|[A-Z0-9_]*TOKEN|DB_ENCRYPTION_KEY|TELEGRAM_BOT_TOKEN)\s*=\s*\S+/i,
  /\bBearer\s+[A-Za-z0-9._-]{12,}/i,
  /\bAuthorization:\s*\S+/i,
  /\bCookie:\s*\S+/i,
  /\bsk-[A-Za-z0-9]{16,}/i, // OpenAI-style keys
  /\bAIza[0-9A-Za-z_-]{20,}/, // Google API key shape
];

export interface GuardVerdict {
  /** True when the input is safe to record/transmit as-is or after redaction. */
  allowed: boolean;
  /** True when a paid/prohibited action was detected — session must stop. */
  approvalRequired: boolean;
  /** Human-readable reason (safe to show and log; never contains a secret). */
  reason: string;
}

/** Classify a URL the operator navigated to. */
export function screenPaidUrl(url: string): GuardVerdict {
  const u = (url || '').trim();
  if (!u) return { allowed: true, approvalRequired: false, reason: '' };
  for (const re of PAID_URL_PATTERNS) {
    if (re.test(u)) {
      return {
        allowed: false,
        approvalRequired: true,
        reason: `Billing/paid page detected (${describeUrl(u)}). Stopped — prohibited and cannot be approved.`,
      };
    }
  }
  return { allowed: true, approvalRequired: false, reason: '' };
}

/** Classify a click/action by the visible control text. */
export function screenPaidAction(controlText: string): GuardVerdict {
  const t = (controlText || '').trim();
  if (!t) return { allowed: true, approvalRequired: false, reason: '' };
  for (const re of PAID_ACTION_PATTERNS) {
    if (re.test(t)) {
      return {
        allowed: false,
        approvalRequired: true,
        reason: `Paid action detected ("${clip(t, 60)}"). Stopped — prohibited and cannot be approved.`,
      };
    }
  }
  return { allowed: true, approvalRequired: false, reason: '' };
}

/** Decide whether a form input value may be recorded, and redact if not. */
export function redactInputValue(field: { name?: string; type?: string; value?: string }): {
  value: string;
  redacted: boolean;
} {
  const type = (field.type || '').toLowerCase();
  const name = field.name || '';
  if (SENSITIVE_INPUT_TYPES.has(type) || SENSITIVE_FIELD_NAME.test(name)) {
    return { value: REDACTED, redacted: true };
  }
  const scrubbed = redactSecrets(field.value || '');
  return { value: scrubbed.text, redacted: scrubbed.redacted };
}

/**
 * Scrub any secret-shaped substrings out of free text (transcripts, page text,
 * AI narration) before it is stored or sent. Returns the cleaned text and
 * whether anything was redacted.
 */
export function redactSecrets(text: string): { text: string; redacted: boolean } {
  if (!text) return { text: '', redacted: false };
  let out = text;
  let redacted = false;
  for (const re of SECRET_LINE_PATTERNS) {
    if (re.test(out)) {
      out = out.replace(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'), (m) => {
        redacted = true;
        // Keep the label (e.g. "API_KEY=") but redact the value.
        const eq = m.indexOf('=');
        if (eq > -1) return m.slice(0, eq + 1) + REDACTED;
        const colon = m.indexOf(':');
        if (colon > -1) return m.slice(0, colon + 1) + ' ' + REDACTED;
        return REDACTED;
      });
    }
  }
  return { text: out, redacted };
}

/** True if a storage surface must never be dumped into an event. */
export function isSensitiveSurface(name: string): boolean {
  return /^(cookie|localstorage|sessionstorage|indexeddb|authorization|set-cookie)$/i.test((name || '').trim());
}

// ── helpers ──────────────────────────────────────────────────────────

function describeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}`.slice(0, 80);
  } catch {
    return clip(url, 80);
  }
}

function clip(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
