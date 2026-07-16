// Memory/checkpoint integration tests: the checkpoint writer derives sprint
// state from the requirement ledger, references proof artifacts by path
// instead of copying them, and REFUSES to record accepted work without
// passing final regression and independent final review.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const TOOL = path.join(REPO_ROOT, 'scripts', 'memory', 'landos-memory.mjs');

const tempRoots: string[] = [];
afterAll(() => {
  for (const root of tempRoots) fs.rmSync(root, { recursive: true, force: true });
});

function runTool(args: string[]): { out: string; code: number } {
  try {
    return { out: execFileSync(process.execPath, [TOOL, ...args], { encoding: 'utf8' }), code: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return { out: `${e.stdout ?? ''}${e.stderr ?? ''}`, code: e.status ?? 1 };
  }
}

function ledgerFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: 1,
    sprintId: 'sprint-x',
    title: 'Fixture sprint',
    createdAt: '2026-07-15T00:00:00.000Z',
    originalPrompt: 'p',
    promptSha256: 'irrelevant-for-memory-tool',
    workstreams: [
      {
        id: 'ws1',
        status: 'accepted',
        finalAcceptance: 'accepted',
        requirements: [],
      },
    ],
    findings: [],
    evidence: [],
    finalRegression: { result: 'pass', at: '2026-07-15T00:00:00.000Z', detail: 'combined', evidenceIds: ['E1'] },
    finalReview: { result: 'pass', at: '2026-07-15T00:00:00.000Z', detail: 'reviewer: ok', evidenceIds: ['E1'] },
    sprintStatus: 'complete',
    log: [],
    ...overrides,
  };
}

function makeRoot(ledger: Record<string, unknown> | null): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'landos-ckpt-test-'));
  tempRoots.push(root);
  fs.mkdirSync(path.join(root, '.landos'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.landos', 'CHECKPOINT.md'),
    '# LandOS Current Checkpoint\n\n## Current unfinished work\n\n- none.\n',
    'utf8',
  );
  if (ledger) {
    const sprintDir = path.join(root, '.landos', 'sprints', String(ledger.sprintId));
    fs.mkdirSync(sprintDir, { recursive: true });
    fs.writeFileSync(
      path.join(root, '.landos', 'sprints', 'current.json'),
      JSON.stringify({ schema: 1, sprintId: ledger.sprintId }),
      'utf8',
    );
    fs.writeFileSync(path.join(sprintDir, 'ledger.json'), JSON.stringify(ledger, null, 2), 'utf8');
  }
  return root;
}

describe('checkpoint sprint integration', () => {
  it('derives sprint state into the checkpoint and links proof by path only', () => {
    const root = makeRoot(ledgerFixture());
    const { code } = runTool(['checkpoint', '--root', root]);
    expect(code).toBe(0);
    const checkpoint = fs.readFileSync(path.join(root, '.landos', 'CHECKPOINT.md'), 'utf8');
    expect(checkpoint).toContain('**Active sprint:** sprint-x (complete)');
    expect(checkpoint).toContain('.landos/sprints/sprint-x/ledger.json');
    expect(checkpoint).toContain('.landos/sprints/sprint-x/report.md');
    expect(checkpoint).not.toContain('combined');
    expect(Buffer.byteLength(checkpoint, 'utf8')).toBeLessThanOrEqual(8192);
  });

  it('refuses to write a checkpoint that marks work accepted without QA proof', () => {
    const root = makeRoot(ledgerFixture({ finalReview: null }));
    const { out, code } = runTool(['checkpoint', '--root', root]);
    expect(code).not.toBe(0);
    expect(out).toContain('lacks QA proof');
    const checkpoint = fs.readFileSync(path.join(root, '.landos', 'CHECKPOINT.md'), 'utf8');
    expect(checkpoint).not.toContain('Active sprint');
  });

  it('audit flags an accepted workstream without passing final review', () => {
    const root = makeRoot(
      ledgerFixture({ finalReview: { result: 'fail', at: 'x', detail: 'regression found', evidenceIds: [] } }),
    );
    const { out } = runTool(['audit', '--json', '--root', root]);
    const audit = JSON.parse(out) as { issues: string[]; pass: boolean };
    expect(audit.pass).toBe(false);
    expect(audit.issues.some((issue) => issue.includes('sprint ledger:'))).toBe(true);
  });

  it('an active sprint checkpoints normally with in-flight status', () => {
    const root = makeRoot(
      ledgerFixture({
        sprintStatus: 'active',
        finalRegression: null,
        finalReview: null,
        workstreams: [
          { id: 'ws1', status: 'browser_qa_failed', finalAcceptance: 'pending', requirements: [] },
        ],
        findings: [{ id: 'F1', workstreamId: 'ws1', status: 'open' }],
      }),
    );
    const { code } = runTool(['checkpoint', '--root', root]);
    expect(code).toBe(0);
    const checkpoint = fs.readFileSync(path.join(root, '.landos', 'CHECKPOINT.md'), 'utf8');
    expect(checkpoint).toContain('**Active sprint:** sprint-x (active)');
    expect(checkpoint).toContain('current workstream ws1 (browser_qa_failed)');
    expect(checkpoint).toContain('1 open QA findings');
  });
});
