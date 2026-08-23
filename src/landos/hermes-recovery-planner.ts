// LandOS — the production recovery planner, bound to the persistent
// `landos-property` Hermes specialist.
//
// This is the ONE place adaptive recovery meets a reasoning runtime. It
// deliberately reuses the existing persistent Property specialist rather than
// provisioning another Property agent: the profile already carries the
// acquisitions reasoning identity, and a second one would drift from it.
//
// THE BOUNDARY, RESTATED IN CODE. The specialist runs on the `clarify` toolset,
// which is a no-op question channel — it cannot browse, search, read the
// repository, run a command, or write a file. It structurally CANNOT acquire
// evidence, which is exactly the property this design depends on: it returns
// directions, LandOS does the research. Nothing in this module writes canonical
// state, and the planner's return value is a string that only
// `parseRecoveryPlan` may interpret.
//
// One-shot, not the persistent Bot Chat: a recovery request for one deal must
// not leave facts in a thread another deal's request would read.

import {
  ANALYST_TOOLSETS,
  hermesProfileProvisioned,
  invokeHermesCli,
  resolveAnalystModel,
} from './acquisition-analyst.js';
import { SPECIALIST_PROFILES } from './specialist-intelligence-executor.js';
import type { RecoveryPlanner } from './adaptive-research-recovery.js';

/** The persistent Property Intelligence specialist. Never a duplicate agent. */
export const RECOVERY_PLANNER_PROFILE = SPECIALIST_PROFILES.property;

/**
 * Planning is a short reasoning turn, not an analysis pass.
 *
 * Four minutes is generous for "which government holds this and how would you
 * reach it" and still bounds a lane that has already missed once.
 */
export const RECOVERY_PLANNER_TIMEOUT_MS = 4 * 60_000;

export interface HermesRecoveryPlannerDeps {
  invoke?: (args: string[], timeoutMs: number) => Promise<string>;
  timeoutMs?: number;
  /** Provisioning probe, injected in tests. */
  provisioned?: (profile: string) => boolean;
}

export function recoveryPlannerArgs(prompt: string): string[] {
  const model = resolveAnalystModel();
  return [
    '--profile', RECOVERY_PLANNER_PROFILE,
    '--provider', model.provider,
    '-m', model.model,
    // Reasoning only. The specialist cannot act on the world.
    '-t', ANALYST_TOOLSETS,
    '--oneshot', prompt,
  ];
}

/**
 * The production planner.
 *
 * Throws when the profile is not provisioned rather than silently degrading:
 * a recovery that never reached a planner must be reported as a failed
 * attempt, not as a researched unknown.
 */
export function createHermesRecoveryPlanner(deps: HermesRecoveryPlannerDeps = {}): RecoveryPlanner {
  const invoke = deps.invoke ?? invokeHermesCli;
  const timeoutMs = deps.timeoutMs ?? RECOVERY_PLANNER_TIMEOUT_MS;
  const provisioned = deps.provisioned ?? hermesProfileProvisioned;

  return async (prompt: string): Promise<string> => {
    if (!provisioned(RECOVERY_PLANNER_PROFILE)) {
      throw new Error(
        `The Hermes specialist profile ${RECOVERY_PLANNER_PROFILE} is not provisioned. Run: npm run landos:hermes:specialists`,
      );
    }
    return invoke(recoveryPlannerArgs(prompt), timeoutMs);
  };
}
