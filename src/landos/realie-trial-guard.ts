// LandOS — Realie trial-call guard (MANUAL control only).
//
// Realie is on a limited trial. Every live Realie call must be approved by Tyler
// immediately beforehand and counted against an approved trial budget. This
// module is the local bookkeeping for that — it makes NO network call itself and
// is NEVER invoked by tests, dashboard startup, or any automatic workflow.
//
// Counter lives ONLY in a local, gitignored runtime file (store/ is gitignored).
// It records timestamp / endpoint / identifier-type / success / remaining — and
// NEVER the API key or response bodies.

import fs from 'fs';
import path from 'path';

/** Account facts (informational) + the session-approved live-call budget. */
export const REALIE_TRIAL = {
  totalTrialCalls: 20,
  preUsedBeforeGuard: 3,
  /** Tyler-approved live calls to make through the guard before upgrading. */
  approvedLimit: 15,
} as const;

export interface RealieCallRecord {
  timestamp: string;
  endpoint: string;
  identifierType: string; // e.g. 'parcelId' | 'address' — never the value
  success: boolean;
  remainingApprovedAfter: number;
}

export interface RealieTrialState {
  approvedLimit: number;
  callsMade: number;
  records: RealieCallRecord[];
}

function defaultFile(): string {
  return path.join(process.cwd(), 'store', 'realie-trial-counter.json');
}

export function loadTrialState(file: string = defaultFile()): RealieTrialState {
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf-8')) as RealieTrialState;
    return {
      approvedLimit: typeof s.approvedLimit === 'number' ? s.approvedLimit : REALIE_TRIAL.approvedLimit,
      callsMade: typeof s.callsMade === 'number' ? s.callsMade : 0,
      records: Array.isArray(s.records) ? s.records : [],
    };
  } catch {
    return { approvedLimit: REALIE_TRIAL.approvedLimit, callsMade: 0, records: [] };
  }
}

export interface RealieCallPreview {
  callNumber: number;
  approvedLimit: number;
  remainingApproved: number;
  endpoint: string;
  identifier: string;
  mayConsumeCredit: boolean;
  /** False when the approved budget is exhausted — caller must NOT proceed. */
  allowed: boolean;
}

/**
 * Build the mandatory pre-call confirmation a human must see BEFORE a live call.
 * Pure: reads the counter, computes the next call number + remaining. Does NOT
 * increment and does NOT call Realie.
 */
export function previewNextCall(
  opts: { endpoint: string; identifier: string; mayConsumeCredit: boolean },
  file: string = defaultFile(),
): RealieCallPreview {
  const state = loadTrialState(file);
  const callNumber = state.callsMade + 1;
  const remainingApproved = Math.max(0, state.approvedLimit - state.callsMade);
  return {
    callNumber,
    approvedLimit: state.approvedLimit,
    remainingApproved,
    endpoint: opts.endpoint,
    identifier: opts.identifier,
    mayConsumeCredit: opts.mayConsumeCredit,
    allowed: remainingApproved > 0,
  };
}

/**
 * Record a live call AFTER it has been made (with Tyler's approval). Increments
 * the counter and appends an audit record. Never stores the key or response body.
 * Returns the remaining approved budget.
 */
export function recordCall(
  opts: { endpoint: string; identifierType: string; success: boolean; now?: () => string },
  file: string = defaultFile(),
): { remainingApproved: number; state: RealieTrialState } {
  const state = loadTrialState(file);
  state.callsMade += 1;
  const remainingApprovedAfter = Math.max(0, state.approvedLimit - state.callsMade);
  state.records.push({
    timestamp: (opts.now ?? (() => new Date().toISOString()))(),
    endpoint: opts.endpoint,
    identifierType: opts.identifierType,
    success: opts.success,
    remainingApprovedAfter,
  });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state, null, 2));
  return { remainingApproved: remainingApprovedAfter, state };
}
