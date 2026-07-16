import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

// Tests for the LandOS durable-memory bootstrap (2026-07-14 repair).
// The system: CLAUDE.md auto-imports .landos/PERMANENT_MEMORY.md (Layer A)
// and .landos/CHECKPOINT.md (Layer B); everything else is on-demand history.
// Tooling lives in scripts/memory/landos-memory.mjs (offline, dependency-free).

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const TOOL = path.join(REPO_ROOT, 'scripts', 'memory', 'landos-memory.mjs');

const PERMANENT = path.join(REPO_ROOT, '.landos', 'PERMANENT_MEMORY.md');
const CHECKPOINT = path.join(REPO_ROOT, '.landos', 'CHECKPOINT.md');
const CLAUDE_MD = path.join(REPO_ROOT, 'CLAUDE.md');
const CONTINUE_CMD = path.join(REPO_ROOT, '.claude', 'commands', 'continue-landos.md');

function runTool(args: string[], cwd: string): { out: string; code: number } {
  try {
    const out = execFileSync(process.execPath, [TOOL, ...args], {
      cwd,
      encoding: 'utf8',
    });
    return { out, code: 0 };
  } catch (err) {
    const e = err as { stdout?: string; status?: number };
    return { out: e.stdout ?? '', code: e.status ?? 1 };
  }
}

function auditJson(root: string): {
  totalEstimatedTokens: number;
  budget: { withinTarget: boolean; withinMax: boolean };
  permanentMemory: { withinBudget: boolean; bytes: number };
  checkpoint: { withinBudget: boolean; staleness: { status: string; reasons: string[] } };
  issues: string[];
  warnings: string[];
  pass: boolean;
} {
  const { out } = runTool(['audit', '--json'], root);
  return JSON.parse(out);
}

const fixtureRoots: string[] = [];
afterAll(() => {
  for (const root of fixtureRoots) rmSync(root, { recursive: true, force: true });
});

function makeFixture(overrides: {
  claudeMd?: string;
  permanent?: string;
  checkpoint?: string;
  continueCmd?: string;
}): string {
  const root = mkdtempSync(path.join(tmpdir(), 'landos-memory-test-'));
  fixtureRoots.push(root);
  mkdirSync(path.join(root, '.landos'), { recursive: true });
  mkdirSync(path.join(root, '.claude', 'commands'), { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  writeFileSync(
    path.join(root, 'CLAUDE.md'),
    overrides.claudeMd ??
      '# Fixture\n\n@.landos/PERMANENT_MEMORY.md\n\n@.landos/CHECKPOINT.md\n',
  );
  writeFileSync(
    path.join(root, '.landos', 'PERMANENT_MEMORY.md'),
    overrides.permanent ?? '# Permanent\n\nRule one.\n',
  );
  writeFileSync(
    path.join(root, '.landos', 'CHECKPOINT.md'),
    overrides.checkpoint ??
      `# Checkpoint\n\n- **Generated:** ${today}\n- **HEAD at generation:** \`abcdef1\`\n\nNext: nothing.\n`,
  );
  writeFileSync(
    path.join(root, '.claude', 'commands', 'continue-landos.md'),
    overrides.continueCmd ?? readFileSync(CONTINUE_CMD, 'utf8'),
  );
  return root;
}

describe('LandOS memory bootstrap: real repository state', () => {
  const claudeMd = readFileSync(CLAUDE_MD, 'utf8');
  const permanent = readFileSync(PERMANENT, 'utf8');
  const checkpoint = readFileSync(CHECKPOINT, 'utf8');
  const continueCmd = readFileSync(CONTINUE_CMD, 'utf8');

  it('CLAUDE.md imports exactly the two Layer A/B memory files', () => {
    const imports = [...claudeMd.matchAll(/^@(\.landos\/[A-Za-z0-9_./-]+\.md)\s*$/gm)].map(
      (m) => m[1],
    );
    expect(imports).toEqual(['.landos/PERMANENT_MEMORY.md', '.landos/CHECKPOINT.md']);
  });

  it('permanent memory stays within its 4 KB budget', () => {
    expect(Buffer.byteLength(permanent, 'utf8')).toBeLessThanOrEqual(4096);
  });

  it('checkpoint stays within its 8 KB budget', () => {
    expect(Buffer.byteLength(checkpoint, 'utf8')).toBeLessThanOrEqual(8192);
  });

  it('combined automatic bootstrap is under the 10k-token target and 20k hard max', () => {
    const audit = auditJson(REPO_ROOT);
    expect(audit.totalEstimatedTokens).toBeLessThan(10_000);
    expect(audit.budget.withinTarget).toBe(true);
    expect(audit.budget.withinMax).toBe(true);
    // Nowhere near the old ~150k-context failure mode.
    expect(audit.totalEstimatedTokens).toBeLessThan(150_000 / 3);
  });

  it('audit passes on the real repo (no secrets, transcripts, MCP output, or budget violations)', () => {
    const audit = auditJson(REPO_ROOT);
    expect(audit.issues).toEqual([]);
    expect(audit.pass).toBe(true);
  });

  it('memory files exclude full prompts, reports, transcripts, and browser output markers', () => {
    for (const text of [permanent, checkpoint]) {
      expect(text).not.toMatch(/WORKSTREAM \d+/);
      expect(text).not.toMatch(/\bmcp__[a-z]/i);
      expect(text).not.toMatch(/data:image\//);
      expect(text).not.toMatch(/\[Voice transcribed\]/);
      // Reports are linked, never pasted: no file in Layer A/B exceeds budget,
      // and no line is a pasted terminal/log dump.
      expect(text).not.toMatch(/\x1b\[[0-9;]*m/);
    }
    // Checkpoint links to detailed reports instead of embedding them.
    expect(checkpoint).toMatch(/docs\/landos\//);
  });

  it('memory files exclude tokenized URLs and secret-shaped values', () => {
    for (const text of [permanent, checkpoint, claudeMd]) {
      expect(text).not.toMatch(/[?&](token|jwt|apikey|api_key|access_token)=[^\s&]+/i);
      expect(text).not.toMatch(/\bAIza[0-9A-Za-z_-]{30,}\b/);
      expect(text).not.toMatch(/-----BEGIN [A-Z ]*PRIVATE KEY-----/);
    }
  });

  it('/continue-landos no longer loads broad history, the docs tree, or the database', () => {
    const loadSection = continueCmd.split(/^## Never load/m)[0];
    for (const banned of [
      'HANDOVER.md',
      'OPERATOR_QA.md',
      'BUSINESS_QA.md',
      'KNOWN_LIMITATIONS.md',
      'PROJECT_MEMORY.md',
      'DECISIONS.md',
      'CHAT_CONTEXT.md',
      'CURRENT_SPRINT.md',
      'store/landos.db',
      'docs/governance',
    ]) {
      expect(loadSection).not.toMatch(new RegExp(`(read|load)[^\\n]*${banned}`, 'i'));
    }
    expect(continueCmd).toMatch(/## Never load/);
    expect(continueCmd).toMatch(/PERMANENT_MEMORY\.md/);
    expect(continueCmd).toMatch(/CHECKPOINT\.md/);
    // It must report what it loaded and the estimated size.
    expect(continueCmd).toMatch(/estimated token/i);
  });

  it('ordinary LandOS task wording does not auto-trigger deep recovery', () => {
    // The command must not declare auto-invoke trigger phrases (the reference
    // kit's /continue auto-fired on "continue"/"status" wording â€” rejected).
    expect(continueCmd).not.toMatch(/auto-invoke/i);
    expect(continueCmd).toMatch(/must not trigger/i);
    // CLAUDE.md bootstrap states the same rule for plain wording.
    expect(claudeMd).toMatch(
      /Ordinary task wording never invokes broad\s+recovery/,
    );
  });

  it('live repository state overrides stale checkpoint narrative', () => {
    expect(checkpoint).toMatch(/override anything written here/i);
    expect(readFileSync(PERMANENT, 'utf8')).toMatch(/override memory-file\s+narrative/i);
  });

  it('the reference starter kit is not required at runtime', () => {
    const toolSource = readFileSync(TOOL, 'utf8');
    for (const text of [toolSource, claudeMd, permanent, checkpoint, continueCmd]) {
      expect(text).not.toMatch(/ix-claude-code-starter-kit|Trejon-888/);
      expect(text).not.toMatch(/scratchpad[\\/]+ix-ref/);
    }
  });

  it('memory tooling works offline: no network, no .env, no database access', () => {
    const toolSource = readFileSync(TOOL, 'utf8');
    expect(toolSource).not.toMatch(/\bfetch\(|node:https?|require\(['"]https?['"]\)|node:net|node:dgram/);
    expect(toolSource).not.toMatch(/['"`]\.env/);
    expect(toolSource).not.toMatch(/landos\.db|sqlite/i);
    // And it must not touch browser automation or property data paths.
    expect(toolSource).not.toMatch(/puppeteer|playwright|chromium|devtools|:9222/i);
  });
});

describe('LandOS memory tooling: detection behavior (fixtures)', () => {
  it('flags a stale checkpoint by date', () => {
    const root = makeFixture({
      checkpoint:
        '# Checkpoint\n\n- **Generated:** 2026-01-01\n- **HEAD at generation:** `abcdef1`\n',
    });
    const audit = auditJson(root);
    expect(audit.checkpoint.staleness.status).toBe('stale');
    expect(audit.checkpoint.staleness.reasons.join(' ')).toMatch(/days old/);
  });

  it('flags a checkpoint missing its HEAD/date fields', () => {
    const root = makeFixture({ checkpoint: '# Checkpoint\n\nno metadata here\n' });
    const audit = auditJson(root);
    expect(audit.checkpoint.staleness.status).toBe('stale');
    expect(audit.checkpoint.staleness.reasons.join(' ')).toMatch(/missing/);
  });

  it('fails the audit when a tokenized URL leaks into the checkpoint', () => {
    const today = new Date().toISOString().slice(0, 10);
    const root = makeFixture({
      checkpoint: `# Checkpoint\n\n- **Generated:** ${today}\n- **HEAD at generation:** \`abcdef1\`\n\nhttp://localhost:3141/deal-cards?token=abc123def456\n`,
    });
    const audit = auditJson(root);
    expect(audit.pass).toBe(false);
    expect(audit.issues.join(' ')).toMatch(/tokenized url/);
  });

  it('fails the audit when raw browser/MCP output leaks into memory', () => {
    const root = makeFixture({
      permanent: '# Permanent\n\nmcp__claude-in-chrome__computer returned a screenshot\n',
    });
    const audit = auditJson(root);
    expect(audit.pass).toBe(false);
    expect(audit.issues.join(' ')).toMatch(/mcp tool output/);
  });

  it('fails the audit when the continue command regresses to loading history', () => {
    const root = makeFixture({
      continueCmd:
        '# /continue-landos\n\n## Load\n\n1. Read .landos/HANDOVER.md\n2. Read .landos/OPERATOR_QA.md\n',
    });
    const audit = auditJson(root);
    expect(audit.pass).toBe(false);
    expect(audit.issues.join(' ')).toMatch(/history file/);
    expect(audit.issues.join(' ')).toMatch(/Never load/);
  });

  it('warns about duplicated long-form content across auto-loaded files', () => {
    const dup =
      'This exact very long duplicated operating rule sentence exists in two auto-loaded memory files simultaneously.';
    const today = new Date().toISOString().slice(0, 10);
    const root = makeFixture({
      permanent: `# Permanent\n\n${dup}\n`,
      checkpoint: `# Checkpoint\n\n- **Generated:** ${today}\n- **HEAD at generation:** \`abcdef1\`\n\n${dup}\n`,
    });
    const audit = auditJson(root);
    expect(audit.warnings.join(' ')).toMatch(/duplicate content/i);
  });

  it('reports loaded files and estimated tokens (status contract)', () => {
    const { out, code } = runTool(['status'], REPO_ROOT);
    expect(code).toBe(0);
    expect(out).toMatch(/CLAUDE\.md: \d+ bytes \(~\d+ tokens\)/);
    expect(out).toMatch(/PERMANENT_MEMORY\.md: \d+ bytes/);
    expect(out).toMatch(/CHECKPOINT\.md: \d+ bytes/);
    expect(out).toMatch(/Total estimated bootstrap: ~\d+ tokens/);
    expect(out).toMatch(/Budget: target < 10000, hard max < 20000/);
  });
});

describe('LandOS memory sprint completion contracts', () => {
  it('accounts for a coding-agent bootstrap through AGENTS.md', () => {
    const result = auditJson(REPO_ROOT) as unknown as {
      profiles: { codingAgent: { estimatedTokens: number; files: Array<{ file: string }> } };
    };
    expect(result.profiles.codingAgent.files.map((item) => item.file)).toEqual([
      'AGENTS.md',
      '.landos/PERMANENT_MEMORY.md',
      '.landos/CHECKPOINT.md',
    ]);
    expect(result.profiles.codingAgent.estimatedTokens).toBeLessThan(10_000);
    const agents = readFileSync(path.join(REPO_ROOT, 'AGENTS.md'), 'utf8');
    expect(agents).toMatch(/This is the LandOS repository/);
    expect(agents).toMatch(/store\/landos\.db/);
    expect(agents).toMatch(/docs\/landos\//);
  });

  it('accounts for Claude auto-memory entrypoint without preloading its topic files', () => {
    const source = readFileSync(TOOL, 'utf8');
    expect(source).toMatch(/resolveClaudeAutoMemoryPath/);
    expect(source).toMatch(/'memory', 'MEMORY\.md'/);
    const { out } = runTool(['status', '--json'], REPO_ROOT);
    const result = JSON.parse(out) as { profiles: { claudeCode: { files: Array<{ file: string }> } } };
    const autoFiles = result.profiles.claudeCode.files.map((item) => item.file)
      .filter((file) => /[\\/]\.claude[\\/].*[\\/]memory[\\/]MEMORY\.md$/i.test(file));
    expect(autoFiles.length).toBeLessThanOrEqual(1);
    expect(result.profiles.claudeCode.files.some((item) => /project_.*\.md$/i.test(item.file))).toBe(false);
  });
  it('fails clearly on a hard automatic-bootstrap budget violation', () => {
    const root = makeFixture({ claudeMd: 'x'.repeat(80_100) });
    const audit = auditJson(root);
    expect(audit.pass).toBe(false);
    expect(audit.budget.withinMax).toBe(false);
    expect(audit.issues.join(' ')).toMatch(/hard max/);
  });

  it('rejects a full final-report prompt and a raw DOM dump', () => {
    const root = makeFixture({
      checkpoint:
        '# Checkpoint\n\n- **Generated:** 2026-07-14\n- **HEAD at generation:** abcdef1\n\nFINAL REPORT\n<html><body>' +
        'operator DOM '.repeat(30) +
        '</body></html>\n',
    });
    const audit = auditJson(root);
    expect(audit.pass).toBe(false);
    expect(audit.issues.join(' ')).toMatch(/full final-report prompt/);
    expect(audit.issues.join(' ')).toMatch(/raw dom dump/);
  });

  it('replaces checkpoint metadata repeatably and stays bounded', () => {
    const root = makeFixture({
      checkpoint:
        '# Checkpoint\n\n- **Generated:** 2026-01-01\n- **HEAD at generation:** abcdef1\n\n## Current unfinished work\n\nKeep this concise.\n',
    });
    expect(runTool(['checkpoint'], root).code).toBe(0);
    expect(runTool(['checkpoint'], root).code).toBe(0);
    const text = readFileSync(path.join(root, '.landos', 'CHECKPOINT.md'), 'utf8');
    expect((text.match(/DERIVED:START/g) ?? []).length).toBe(1);
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(8192);
    expect(text).toMatch(/Current unfinished work/);
  });

  it('memory tooling does not modify property/operator database bytes', () => {
    const root = makeFixture({});
    mkdirSync(path.join(root, 'store'), { recursive: true });
    const database = path.join(root, 'store', 'landos.db');
    writeFileSync(database, Buffer.from([0, 1, 2, 3, 4, 5]));
    const before = readFileSync(database);
    runTool(['status', '--json'], root);
    runTool(['audit', '--json'], root);
    runTool(['checkpoint'], root);
    expect(readFileSync(database)).toEqual(before);
  });

  it('retrieves only task-specific excerpts with freshness and context estimates', () => {
    const root = makeFixture({});
    mkdirSync(path.join(root, 'docs', 'landos'), { recursive: true });
    writeFileSync(
      path.join(root, 'docs', 'landos', 'Active.md'),
      '# Parallel resolution\n\nCurrent lane blocker and reconciliation guidance.\n',
    );
    writeFileSync(
      path.join(root, 'docs', 'landos', 'Legacy.md'),
      '# Old lane\n\nLegacy and superseded parallel lane guidance.\n',
    );
    const result = runTool(['retrieve', 'parallel', 'lane', '--json'], root);
    expect(result.code).toBe(0);
    const parsed = JSON.parse(result.out) as {
      matches: Array<{ file: string; freshness: string; status: string; excerpt: string }>;
      approximateAddedTokens: number;
    };
    expect(parsed.matches.length).toBeGreaterThan(0);
    expect(parsed.matches.every((item) => item.excerpt.length <= 900)).toBe(true);
    expect(parsed.matches.every((item) => item.freshness.includes('T'))).toBe(true);
    expect(parsed.matches.some((item) => item.status.includes('superseded'))).toBe(true);
    expect(parsed.approximateAddedTokens).toBeLessThanOrEqual(2500);
  });

  it('keeps LandPortal and browser automation implementation present', () => {
    for (const rel of [
      'src/landos/browser-session.ts',
      'src/landos/browser-session-auth.test.ts',
      'src/landos/browser-comp-research.test.ts',
      'web/src/pages/BrowserConnect.tsx',
    ]) {
      expect(readFileSync(path.join(REPO_ROOT, rel), 'utf8').length).toBeGreaterThan(100);
    }
  });
});
describe('read-only live safety probe', () => {
  it('uses GET-only localhost requests and never prints the configured credential', () => {
    const source = readFileSync(path.join(REPO_ROOT, 'scripts', 'memory', 'live-safety-readonly.mjs'), 'utf8');
    expect(source).not.toMatch(/method:\s*['"](?:POST|PUT|PATCH|DELETE)/i);
    expect(source).not.toMatch(/console\.log\([^)]*DASHBOARD_TOKEN/);
    expect(source).toMatch(/currentDealCardLoaded/);
    expect(source).toMatch(/stableDataDigest/);
  });
});
