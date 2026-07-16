// Requirement-ledger tests: decomposition, prompt preservation, validation,
// evidence linking, report rendering, and preservation of unrelated files.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  addEvidence,
  createSprint,
  getCurrentSprintId,
  loadLedger,
  redactUrl,
  renderLedgerReport,
  saveLedger,
  setCurrentSprint,
  sha256,
  validateLedger,
} from './ledger.js';
import { FIXED_NOW, makeLedger, workstreamSpec } from './test-fixtures.js';

const tempRoots: string[] = [];
afterAll(() => {
  for (const root of tempRoots) fs.rmSync(root, { recursive: true, force: true });
});
function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'landos-ledger-test-'));
  tempRoots.push(root);
  return root;
}

describe('sprint decomposition', () => {
  it('converts a multi-project prompt into multiple staged workstreams', () => {
    const ledger = makeLedger();
    expect(ledger.workstreams).toHaveLength(2);
    expect(ledger.workstreams.map((w) => w.status)).toEqual(['planned', 'planned']);
    expect(ledger.workstreams[1].dependsOn).toEqual(['ws1']);
  });

  it('preserves the original prompt verbatim and detects silent narrowing', () => {
    const ledger = makeLedger();
    expect(ledger.promptSha256).toBe(sha256(ledger.originalPrompt));
    ledger.originalPrompt = 'Build A only.';
    expect(validateLedger(ledger)).toContain('original prompt was altered after sprint creation');
  });

  it('refuses a plan whose workstreams are missing required ledger fields', () => {
    expect(() =>
      createSprint({
        sprintId: 's',
        title: 't',
        originalPrompt: 'p',
        workstreams: [workstreamSpec('ws1', { operatorOutcome: '', requiredProofs: [] })],
        now: FIXED_NOW,
      }),
    ).toThrow(/missing operatorOutcome.*missing requiredProofs|missing requiredProofs.*missing operatorOutcome/s);
  });

  it('refuses a workstream without a browser journey or requirements', () => {
    expect(() =>
      createSprint({
        sprintId: 's',
        title: 't',
        originalPrompt: 'p',
        workstreams: [workstreamSpec('ws1', { browserJourney: { steps: [] }, requirements: [] })],
        now: FIXED_NOW,
      }),
    ).toThrow(/browser journey|requirements/);
  });

  it('detects unknown and cyclic dependencies', () => {
    expect(() =>
      makeLedger([
        workstreamSpec('ws1', { dependsOn: ['ws2'] }),
        workstreamSpec('ws2', { dependsOn: ['ws1'] }),
      ]),
    ).toThrow(/dependency cycle/);
    expect(() => makeLedger([workstreamSpec('ws1', { dependsOn: ['ghost'] })])).toThrow(/unknown workstream ghost/);
  });
});

describe('evidence and reports', () => {
  it('links proof artifacts by path instead of copying content', () => {
    const ledger = makeLedger();
    const evidence = addEvidence(
      ledger,
      { kind: 'screenshot', summary: 'card', path: '.runtime/landos/qa/x.png', workstreamId: 'ws1' },
      FIXED_NOW,
    );
    ledger.workstreams[0].requirements[0].verified = true;
    ledger.workstreams[0].requirements[0].evidenceIds = [evidence.id];
    const report = renderLedgerReport(ledger);
    expect(report).toContain('.runtime/landos/qa/x.png');
    expect(report).toContain('derived from ledger evidence');
  });

  it('redacts tokenized URLs before they can persist', () => {
    expect(redactUrl('http://localhost:3141/landos?token=abc123&deal=7')).toBe(
      'http://localhost:3141/landos?token=REDACTED&deal=7',
    );
    const ledger = makeLedger();
    const evidence = addEvidence(
      ledger,
      { kind: 'live_url', summary: 'card url', url: 'http://localhost:3141/?token=secret123', workstreamId: 'ws1' },
      FIXED_NOW,
    );
    expect(evidence.url).not.toContain('secret123');
  });

  it('flags requirements verified without linked evidence', () => {
    const ledger = makeLedger();
    ledger.workstreams[0].requirements[0].verified = true;
    expect(validateLedger(ledger).some((p) => p.includes('verified without linked evidence'))).toBe(true);
  });
});

describe('persistence and preservation', () => {
  it('round-trips through disk and tracks the current sprint pointer', () => {
    const root = tempRoot();
    const ledger = makeLedger();
    saveLedger(root, ledger);
    setCurrentSprint(root, ledger.sprintId);
    expect(getCurrentSprintId(root)).toBe('sprint-test');
    const loaded = loadLedger(root, 'sprint-test');
    expect(loaded.workstreams).toHaveLength(2);
    expect(loaded.promptSha256).toBe(ledger.promptSha256);
  });

  it('writes only under .landos/sprints and preserves unrelated dirty work', () => {
    const root = tempRoot();
    const unrelated = path.join(root, 'src-existing-work.ts');
    fs.writeFileSync(unrelated, 'const untouched = true;', 'utf8');
    saveLedger(root, makeLedger());
    expect(fs.readFileSync(unrelated, 'utf8')).toBe('const untouched = true;');
    const entries = fs.readdirSync(root).sort();
    expect(entries).toEqual(['.landos', 'src-existing-work.ts']);
  });
});
