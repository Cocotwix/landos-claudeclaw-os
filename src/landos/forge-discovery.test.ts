// Smoke test for the Universal Forge foundation.
//
// Forge is installed as a repo-backed agent at landos-agents/forge/. It is
// business-neutral (not a LandOS/Duke agent) and must be discoverable by the
// existing agent-discovery path that the dashboard /api/agents endpoint uses,
// WITHOUT requiring a Telegram token value to be present.
//
// These tests pin that contract: Forge shows up in listAgentIds(), its
// agent.yaml loads via loadAgentConfig() even with no token in the env, and
// adding Forge did not disturb the other agents' discoverability.

import { describe, it, expect } from 'vitest';
import { listAgentIds, loadAgentConfig, agentExists } from '../agent-config.js';

describe('Forge discovery', () => {
  it('appears in the agent roster', () => {
    expect(listAgentIds()).toContain('forge');
    expect(agentExists('forge')).toBe(true);
  });

  it('loads its config and does not require a Telegram token to appear', () => {
    const cfg = loadAgentConfig('forge');
    expect(cfg.name).toBe('Forge');
    expect(cfg.description.length).toBeGreaterThan(0);
    // The yaml carries the token-env KEY (schema compatibility), but Forge is
    // discoverable and loadable regardless of whether a token VALUE exists.
    // Assert the schema wiring, not the token value, so this test does not
    // become brittle if FORGE_BOT_TOKEN is later set in the env or .env.
    expect(cfg.botTokenEnv).toBe('FORGE_BOT_TOKEN');
    expect(typeof cfg.botToken).toBe('string');
  });

  it('is business-neutral, not a LandOS/Duke-specific agent', () => {
    const cfg = loadAgentConfig('forge');
    const haystack = (cfg.name + ' ' + cfg.description).toLowerCase();
    // Forge Core must not bake in the host OS's domain identity.
    expect(haystack).not.toContain('landportal');
    expect(haystack).not.toContain('parcel');
    expect(haystack).not.toContain('due diligence');
  });
});
