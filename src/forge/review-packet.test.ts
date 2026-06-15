import { describe, it, expect } from 'vitest';

import { generateReviewPacket } from './review-packet.js';

describe('generateReviewPacket', () => {
  it('includes every required section', () => {
    const out = generateReviewPacket({
      title: 'Forge layer',
      repoPath: 'C:/Users/tbutt/claudeclaw-os',
      currentCommit: 'abc1234',
      previousPushedCommit: 'def5678',
      expectedChangedFiles: ['src/forge/host-store.ts'],
      verdict: 'SAFE',
      rawRequest: 'Add the operating layer.',
    });
    expect(out).toContain('# Codex Review Packet');
    expect(out).toContain('Repo:');
    expect(out).toContain('Current commit:');
    expect(out).toContain('Previous pushed commit:');
    expect(out).toContain('Expected changed files:');
    expect(out).toContain('Architecture rules');
    expect(out).toContain('Security rules');
    expect(out).toContain('Tests to run:');
    expect(out).toContain('Do NOT modify, stage, commit, or push');
    expect(out).toContain('PASS or FAIL');
    expect(out).toContain('Safe to push: Yes or No');
    expect(out).toContain('Recommended next step');
  });

  it('renders placeholders when runtime facts are missing', () => {
    const out = generateReviewPacket({ title: 'bare' });
    expect(out).toContain('<fill in>');
    // default Forge test set is included
    expect(out).toContain('npm run typecheck');
    expect(out).toContain('npm run build:web');
  });

  it('is deterministic for the same input', () => {
    const input = { title: 't', currentCommit: 'aaa' };
    expect(generateReviewPacket(input)).toBe(generateReviewPacket(input));
  });
});
