/**
 * Structured error taxonomy for ClaudeClaw agent failures.
 *
 * Classifies errors from the Claude Code SDK into actionable categories
 * with recovery hints, so the user gets helpful messages instead of
 * "Something went wrong."
 *
 * The category decision itself lives in failure-classification.ts, which is
 * shared with the scheduler and mission paths so a failure is named the same
 * way wherever an operator meets it. This module owns only the ClaudeClaw
 * recovery policy layered on top (retry / new chat / switch model).
 */

import { classifyExecution, type ExecutionOutcome, type FailureCategory } from './failure-classification.js';

export type ErrorCategory =
  | 'auth'
  /** Nothing to authenticate WITH, as opposed to a rejected credential. */
  | 'credentials_missing'
  | 'rate_limit'
  | 'context_exhausted'
  | 'timeout'
  | 'subprocess_crash'
  /** The provider process never started (binary missing / not executable). */
  | 'launch_failure'
  | 'network'
  | 'billing'
  | 'overloaded'
  /** Stopped deliberately by an operator. */
  | 'cancelled'
  /** Ran cleanly but produced nothing usable. */
  | 'invalid_output'
  | 'unknown';

export interface ErrorRecovery {
  shouldRetry: boolean;
  shouldNewChat: boolean;
  shouldSwitchModel: boolean;
  retryAfterMs: number;
  userMessage: string;
}

export class AgentError extends Error {
  category: ErrorCategory;
  recovery: ErrorRecovery;
  originalError: Error | undefined;
  /**
   * The structured taxonomy entry from failure-classification.ts. Finer-grained
   * than `category` (which stays on its historical value set for existing
   * call sites) and safe to persist: its `detail` is already redacted.
   */
  outcome: ExecutionOutcome | undefined;

  constructor(
    category: ErrorCategory,
    recovery: ErrorRecovery,
    originalError?: Error,
    outcome?: ExecutionOutcome,
  ) {
    super(recovery.userMessage);
    this.name = 'AgentError';
    this.category = category;
    this.recovery = recovery;
    this.originalError = originalError;
    this.outcome = outcome;
  }
}

// ── Recovery policy ─────────────────────────────────────────────────
//
// Pattern matching used to live here, ahead of which it ran BEFORE the
// exit-code checks — with the exit-code checks first, an expired login (which
// the SDK surfaces as "exited with code 1" plus auth text on stderr) was
// reported as `subprocess_crash` and retried three times. Classification now
// comes from failure-classification.ts, which reads provider meaning first and
// only falls back to the exit code when there is none. This table maps that
// taxonomy onto ClaudeClaw's recovery policy.

interface Policy {
  category: ErrorCategory;
  recovery: ErrorRecovery;
}

const POLICY: Partial<Record<FailureCategory, Policy>> = {
  auth: {
    category: 'auth',
    recovery: {
      shouldRetry: false,
      shouldNewChat: false,
      shouldSwitchModel: false,
      retryAfterMs: 0,
      userMessage: 'Authentication failed. Run `claude login` in your terminal to re-authenticate.',
    },
  },
  credentials_missing: {
    category: 'credentials_missing',
    recovery: {
      shouldRetry: false,
      shouldNewChat: false,
      shouldSwitchModel: false,
      retryAfterMs: 0,
      userMessage: 'No provider credential is configured. Run `claude login`, or set the provider API key in .env, then restart.',
    },
  },
  quota: {
    category: 'billing',
    recovery: {
      shouldRetry: false,
      shouldNewChat: false,
      shouldSwitchModel: true,
      retryAfterMs: 0,
      userMessage: 'API credits exhausted or billing issue. Check your Anthropic account, or try a different model.',
    },
  },
  rate_limit: {
    category: 'rate_limit',
    recovery: {
      shouldRetry: true,
      shouldNewChat: false,
      shouldSwitchModel: false,
      retryAfterMs: 30000,
      userMessage: 'Rate limited. Retrying in 30s...',
    },
  },
  provider_unavailable: {
    category: 'overloaded',
    recovery: {
      shouldRetry: true,
      shouldNewChat: false,
      shouldSwitchModel: true,
      retryAfterMs: 5000,
      userMessage: 'Model is overloaded. Retrying...',
    },
  },
  network: {
    category: 'network',
    recovery: {
      shouldRetry: true,
      shouldNewChat: false,
      shouldSwitchModel: false,
      retryAfterMs: 3000,
      userMessage: 'Network error. Check your connection. Retrying...',
    },
  },
  timeout: {
    category: 'timeout',
    recovery: {
      shouldRetry: true,
      shouldNewChat: false,
      shouldSwitchModel: false,
      retryAfterMs: 2000,
      userMessage: 'Request timed out. Retrying...',
    },
  },
  launch_failure: {
    category: 'launch_failure',
    // Not retryable: a missing or non-executable binary will still be missing
    // on the next attempt. Retrying it wasted the whole retry budget.
    recovery: {
      shouldRetry: false,
      shouldNewChat: false,
      shouldSwitchModel: false,
      retryAfterMs: 0,
      userMessage: 'The provider CLI could not be started. Check that it is installed and on PATH for the ClaudeClaw service, then restart.',
    },
  },
  cancelled: {
    category: 'cancelled',
    recovery: {
      shouldRetry: false,
      shouldNewChat: false,
      shouldSwitchModel: false,
      retryAfterMs: 0,
      userMessage: 'Cancelled.',
    },
  },
  invalid_output: {
    category: 'invalid_output',
    recovery: {
      shouldRetry: true,
      shouldNewChat: false,
      shouldSwitchModel: false,
      retryAfterMs: 2000,
      userMessage: 'The run finished but produced no usable output. Retrying...',
    },
  },
  context_exhausted: {
    category: 'context_exhausted',
    recovery: {
      shouldRetry: false,
      shouldNewChat: true,
      shouldSwitchModel: false,
      retryAfterMs: 0,
      userMessage: 'Context window limit reached. Use /newchat to start fresh.',
    },
  },
  crash: {
    category: 'subprocess_crash',
    recovery: {
      shouldRetry: true,
      shouldNewChat: false,
      shouldSwitchModel: false,
      retryAfterMs: 2000,
      userMessage: 'Claude Code subprocess crashed. Retrying...',
    },
  },
};

// ── Classification ──────────────────────────────────────────────────

/**
 * Classify a raw error from the Claude Code SDK into a structured AgentError.
 *
 * Order of reasoning:
 *   1. the expired-SDK-session special case (recoverable by restarting fresh)
 *   2. provider meaning in the message — auth, credentials, quota, rate limit,
 *      unavailable, network, launch, timeout, cancellation, context
 *   3. only then the exit code, which by itself says a process ended but not why
 *
 * If the error is already an AgentError, returns it unchanged.
 */
export function classifyError(err: unknown, contextTokens?: number): AgentError {
  // Pass through already-classified errors
  if (err instanceof AgentError) return err;

  const raw = err instanceof Error ? err : new Error(String(err));
  const text = raw.message;

  if (/no conversation found with session id/i.test(text)) {
    return new AgentError('unknown', {
      shouldRetry: true,
      shouldNewChat: true,
      shouldSwitchModel: false,
      retryAfterMs: 0,
      userMessage: 'The prior Max session expired; starting a fresh session.',
    }, raw);
  }

  // Provider meaning first. classifyExecution is given no exit code here — the
  // SDK reports exits inside the message text, and attributing them is this
  // function's job (see below), not the shared classifier's.
  const outcome = classifyExecution({ error: raw });
  const policy = POLICY[outcome.category];
  if (policy) {
    return new AgentError(policy.category, policy.recovery, raw, outcome);
  }

  // No provider meaning. Now the exit code is the best evidence available.
  //
  // Context exhaustion: the process exits with code 1 when context is full, and
  // a large last-call input count is the tell that distinguishes it from a
  // genuine crash.
  if (text.includes('exited with code 1') && contextTokens && contextTokens > 0) {
    return new AgentError('context_exhausted', {
      shouldRetry: false,
      shouldNewChat: true,
      shouldSwitchModel: false,
      retryAfterMs: 0,
      userMessage: `Context window likely exhausted (~${Math.round(contextTokens / 1000)}k tokens). Use /newchat to start fresh, then /respin to pull recent conversation back in.`,
    }, raw, outcome);
  }

  if (text.includes('exited with code 1')) {
    return new AgentError('subprocess_crash', {
      shouldRetry: true,
      shouldNewChat: false,
      shouldSwitchModel: false,
      retryAfterMs: 2000,
      userMessage: 'Claude Code subprocess crashed. Retrying...',
    }, raw, { ...outcome, category: 'crash' });
  }

  if (text.includes('exited with code')) {
    return new AgentError('subprocess_crash', {
      shouldRetry: true,
      shouldNewChat: false,
      shouldSwitchModel: false,
      retryAfterMs: 2000,
      userMessage: 'Claude Code subprocess exited unexpectedly. Retrying...',
    }, raw, { ...outcome, category: 'crash' });
  }

  return new AgentError('unknown', {
    shouldRetry: false,
    shouldNewChat: false,
    shouldSwitchModel: false,
    retryAfterMs: 0,
    userMessage: 'Something went wrong. Check the logs and try again.',
  }, raw, outcome);
}
