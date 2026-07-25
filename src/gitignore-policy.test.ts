/**
 * Ignore policy for secret-bearing backup and deployment files.
 *
 * `.env` alone was ignored, which left the more dangerous files exposed: a
 * credential-rotation script writes a FULL COPY of .env to `.env.bak-rotate`,
 * and `.env.local` / `.env.production` are just as live. A single `git add .`
 * would have staged them.
 *
 * These tests ask git itself (`git check-ignore`) rather than pattern-matching
 * the .gitignore text, so they prove the actual behavior — including that the
 * deny-then-allow block still leaves the documented templates tracked.
 *
 * No file is created and nothing is staged; `git check-ignore` answers for
 * hypothetical paths.
 */

import { describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'child_process';
import path from 'path';

const PROJECT_ROOT = path.resolve(__dirname, '..');

/**
 * Ask git which ignore pattern (if any) matches each path.
 *
 * One batched process for the whole set — `git check-ignore` is slow enough
 * that a call per path dominated the suite's runtime. `-v` reports the
 * matching rule, which the pattern-scoped assertion below needs.
 */
interface Match {
  /** The .gitignore pattern that decided this path. */
  pattern: string;
  /** True when that pattern is a negation (`!foo`), i.e. an explicit re-include. */
  negated: boolean;
}

function matchedPatterns(paths: string[]): Map<string, Match> {
  const res = spawnSync('git', ['check-ignore', '-v', '--no-index', '--stdin'], {
    cwd: PROJECT_ROOT,
    input: paths.join('\n'),
    encoding: 'utf-8',
  });
  // 0 = at least one match, 1 = no matches, anything else = git failed.
  if (res.status !== 0 && res.status !== 1) {
    throw new Error(`git check-ignore failed: ${res.stderr || res.error}`);
  }
  const out = new Map<string, Match>();
  for (const line of (res.stdout || '').split('\n')) {
    if (!line.trim()) continue;
    // Format: <source>:<line>:<pattern>\t<path>
    const tab = line.lastIndexOf('\t');
    if (tab === -1) continue;
    const rule = line.slice(0, tab);
    const file = line.slice(tab + 1).trim();
    const pattern = rule.slice(rule.lastIndexOf(':') + 1);
    // `-v` reports the deciding rule whether it ignores or re-includes, and
    // still exits 0 for a negation — so the `!` prefix, not the exit code, is
    // what says whether the file is actually ignored.
    out.set(file, { pattern, negated: pattern.startsWith('!') });
  }
  return out;
}

/** True when git would ignore `relPath`. */
function isIgnored(relPath: string): boolean {
  const match = matchedPatterns([relPath]).get(relPath);
  return match !== undefined && !match.negated;
}

/** Paths git currently tracks (used to prove nothing tracked became ignored). */
function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files'], { cwd: PROJECT_ROOT, encoding: 'utf-8' })
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * The patterns this phase added. The tracked-file regression below is scoped
 * to these: the repo has long-standing intentional overlaps (CLAUDE.md and
 * agents/CLAUDE.md are ignored as personal config yet tracked for the
 * template/LandOS agents), and re-litigating those is not this phase's job.
 */
const NEW_PATTERNS = new Set([
  '.env*',
  '*.bak',
  '*.bak-rotate',
  '*.bak.rotate',
  '*.backup',
  'claudeclaw-deploy.conf',
  'landos-deploy.conf',
]);

describe('gitignore — secret-bearing environment files', () => {
  const mustBeIgnored = [
    '.env',
    // Rotation copies: full duplicates of .env written by rotation tooling.
    '.env.bak-rotate',
    '.env.oauth.bak-rotate',
    '.env.2026-07-25.bak-rotate',
    // Ordinary backup and editor copies.
    '.env.bak',
    '.env.backup',
    '.env.old',
    '.env.orig',
    '.env.save',
    '.env.swp',
    '.env~',
    // Environment variants that carry live values.
    '.env.local',
    '.env.production',
    '.env.development.local',
    // A suffix nobody predicted — the whole point of deny-then-allow.
    '.env.something-nobody-thought-of',
  ];

  for (const file of mustBeIgnored) {
    it(`ignores ${file}`, () => {
      expect(isIgnored(file)).toBe(true);
    });
  }
});

describe('gitignore — rotation and backup copies anywhere in the tree', () => {
  const mustBeIgnored = [
    '.env.bak-rotate',
    'config.bak-rotate',
    'config.bak.rotate',
    'credentials.bak',
    'secrets.backup',
    'scripts/rotate-token.bak-rotate',
    'landos-agents/main/agent.yaml.bak',
    'docs/landos/notes.backup',
  ];

  for (const file of mustBeIgnored) {
    it(`ignores ${file}`, () => {
      expect(isIgnored(file)).toBe(true);
    });
  }
});

describe('gitignore — deployment configuration', () => {
  const mustBeIgnored = [
    'claudeclaw-deploy.conf',
    'deploy/claudeclaw-deploy.conf',
    'landos-deploy.conf',
    'scripts/landos-deploy.conf',
  ];

  for (const file of mustBeIgnored) {
    it(`ignores ${file}`, () => {
      expect(isIgnored(file)).toBe(true);
    });
  }
});

describe('gitignore — legitimate templates stay visible', () => {
  const mustNotBeIgnored = [
    '.env.example',
    '.env.sample',
    '.env.template',
    '.env.production.example',
    'deploy/claudeclaw-deploy.conf.example',
  ];

  for (const file of mustNotBeIgnored) {
    it(`does not ignore ${file}`, () => {
      expect(isIgnored(file)).toBe(false);
    });
  }

  it('leaves the tracked .env.example tracked', () => {
    // The one template that actually exists today. If the deny-then-allow
    // block ever stops re-including it, the repo loses its documented
    // configuration reference.
    expect(trackedFiles()).toContain('.env.example');
    expect(isIgnored('.env.example')).toBe(false);
  });

  it('no pattern added by this phase swallows a tracked file', () => {
    // The blunt regression: broad patterns like `*.bak` and `.env*` are
    // exactly how an ignore rule quietly eats a real file.
    const matches = matchedPatterns(trackedFiles());
    const swallowed = [...matches.entries()]
      .filter(([, m]) => !m.negated && NEW_PATTERNS.has(m.pattern))
      .map(([file, m]) => `${file} (matched ${m.pattern})`);
    expect(swallowed).toEqual([]);
  });
});
