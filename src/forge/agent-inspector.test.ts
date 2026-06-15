// Tests for the read-only existing-agent inspector host adapter.
//
// Focus: the writeback target-path safety check must block key-named files as
// filename tokens (key.json, api-key.json, private-key.txt) while still allowing
// ordinary allowlisted files. Uses the repo-shipped landos-agents/forge folder,
// which exists in every checkout, so the path check runs against a real folder.
// Read-only: these tests never write anything.

import { describe, it, expect } from 'vitest';

import { inspectTargetPath } from './agent-inspector.js';

describe('inspectTargetPath — key/secret-named files are never safe to write', () => {
  for (const name of [
    'key.json',
    'api-key.json',
    'private-key.txt',
    'api_key.yaml',
    'signing.key',
    'secret-config.json',
    'auth-token.txt',
    'aws-credentials.json',
  ]) {
    it(`blocks ${name}`, () => {
      const meta = inspectTargetPath('forge', name);
      expect(meta.safeToWriteLater).toBe(false);
      expect((meta.riskFlags ?? []).length).toBeGreaterThan(0);
    });
  }
});

describe('inspectTargetPath — ordinary files are not over-blocked', () => {
  for (const name of [
    'agent-profile.json',
    'forge-profile-notes.md',
    'monkey.json',
    'keyword-notes.md',
  ]) {
    it(`allows ${name}`, () => {
      const meta = inspectTargetPath('forge', name);
      expect(meta.safeToWriteLater).toBe(true);
      expect(meta.riskFlags ?? []).toEqual([]);
    });
  }
});

describe('inspectTargetPath — path containment', () => {
  it('blocks traversal and excluded/hidden segments', () => {
    expect(inspectTargetPath('forge', '../escape.md').safeToWriteLater).toBe(false);
    expect(inspectTargetPath('forge', '.git/config').safeToWriteLater).toBe(false);
    expect(inspectTargetPath('forge', 'node_modules/x.json').safeToWriteLater).toBe(false);
  });

  it('rejects an invalid slug', () => {
    expect(inspectTargetPath('../etc', 'agent-profile.json').safeToWriteLater).toBe(false);
  });
});
