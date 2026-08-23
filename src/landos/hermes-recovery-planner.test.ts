import { describe, expect, it, vi } from 'vitest';

import {
  RECOVERY_PLANNER_PROFILE,
  createHermesRecoveryPlanner,
  recoveryPlannerArgs,
} from './hermes-recovery-planner.js';

describe('the recovery planner binding', () => {
  it('reuses the existing persistent Property specialist rather than a new agent', () => {
    expect(RECOVERY_PLANNER_PROFILE).toBe('landos-property');
    expect(recoveryPlannerArgs('plan this')).toContain('landos-property');
  });

  it('runs reasoning-only, so the specialist structurally cannot research or write', () => {
    const args = recoveryPlannerArgs('plan this');
    const toolsetIndex = args.indexOf('-t');
    expect(toolsetIndex).toBeGreaterThan(-1);
    expect(args[toolsetIndex + 1]).toBe('clarify');
    // No skills are granted, and the turn is one-shot rather than a
    // persistent thread another deal could read.
    expect(args).not.toContain('--skills');
    expect(args).toContain('--oneshot');
  });

  it('passes the prompt through as the one-shot payload', () => {
    const args = recoveryPlannerArgs('WHO HOLDS THE ZONING MAP?');
    expect(args[args.length - 1]).toBe('WHO HOLDS THE ZONING MAP?');
  });

  it('returns the runtime reply verbatim for the parser to interpret', async () => {
    const invoke = vi.fn().mockResolvedValue('{"approach":"read the official map"}');
    const planner = createHermesRecoveryPlanner({ invoke, provisioned: () => true });
    await expect(planner('prompt', {} as never)).resolves.toBe('{"approach":"read the official map"}');
    expect(invoke).toHaveBeenCalledOnce();
  });

  it('fails loudly when the profile is not provisioned instead of degrading quietly', async () => {
    const invoke = vi.fn();
    const planner = createHermesRecoveryPlanner({ invoke, provisioned: () => false });
    await expect(planner('prompt', {} as never)).rejects.toThrow(/not provisioned/);
    // A recovery that never reached a planner must not look like research.
    expect(invoke).not.toHaveBeenCalled();
  });
});
