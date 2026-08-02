import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  HERMES_LANDPORTAL_CDP_SKILL,
  HERMES_LANDPORTAL_CONTEXT_SKILL,
  HERMES_LANDPORTAL_HARD_TIMEOUT_MS,
  HERMES_LANDPORTAL_PROFILE,
  HERMES_LANDPORTAL_TARGET_RUNTIME_MS,
  hermesLandPortalInvocationArgs,
  hermesLandPortalOutputFile,
  hermesLandPortalPrompt,
  resetHermesLandPortalLaneCache,
  runHermesLandPortalLane,
  type HermesLandPortalLaneInput,
} from './hermes-landportal-auto.js';
import type { HermesLandPortalImportResult } from './hermes-landportal-import.js';

const input = (): HermesLandPortalLaneInput => ({
  runId: 'deal-intelligence-run-91',
  dealCardId: 91,
  propertyCardId: 109,
  address: '0 SOUTHARD RD, CATO, NY 13033',
  apn: '053289 47.00-1-6',
  owner: 'TEST OWNER',
  county: 'Cayuga',
  state: 'NY',
  landPortalPropertyId: null,
});

const importedResult = (file: string): HermesLandPortalImportResult => ({
  imported: true,
  runId: 'hermes-import-109',
  sourceFile: file,
  sourceUrl: 'https://landportal.com/?property=verified',
  capturedAt: '2026-08-02T03:00:00.000Z',
  captureTimestampSource: 'json',
  propertyCardId: 109,
  dealCardId: 91,
  validationChecks: [],
  importedSubjectFields: ['owner', 'deeded_acres'],
  importedCompCount: 3,
  createdCompCount: 3,
  duplicateCompCount: 0,
  rejectedFields: [],
  canonicalEvidenceRetained: 2,
});

let dirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-landportal-auto-'));
  dirs.push(dir);
  return dir;
}

beforeEach(() => resetHermesLandPortalLaneCache());

afterEach(() => {
  resetHermesLandPortalLaneCache();
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

describe('automatic Hermes LandPortal lane', () => {
  it('uses the dedicated profile, lean assignment prompt, and address-first property-specific filename', () => {
    const subject = input();
    const file = hermesLandPortalOutputFile(subject, 'C:\\hermes\\shared');
    expect(path.basename(file)).toBe('0-southard-rd-cato-ny-13033__property-card-109__deal-intelligence-run-91.json');
    const prompt = hermesLandPortalPrompt(subject, file);
    expect(prompt).toContain('0 SOUTHARD RD, CATO, NY 13033');
    expect(prompt).toContain('053289 47.00-1-6');
    expect(prompt).toContain('TEST OWNER');
    expect(prompt).toContain('Cayuga');
    expect(prompt).toContain('property_card_id');
    expect(prompt).toContain('output_file');
    expect(prompt).toContain(HERMES_LANDPORTAL_CONTEXT_SKILL);
    expect(prompt).not.toContain('BEGIN APPROVED LANDOS PROPERTY INTELLIGENCE SOP');
    expect(prompt).not.toContain('### 10A. Hermes bounded subject lookup');
    expect(prompt.length).toBeLessThan(2_000);
    expect(hermesLandPortalInvocationArgs('lookup')).toEqual([
      '--profile', HERMES_LANDPORTAL_PROFILE,
      '--skills', `${HERMES_LANDPORTAL_CDP_SKILL},${HERMES_LANDPORTAL_CONTEXT_SKILL}`,
      '--oneshot', 'lookup',
    ]);
  });

  it('caps every Hermes invocation at the five-minute hard ceiling', async () => {
    const subject = { ...input(), runId: 'hard-timeout-cap' };
    const directory = tempDir();
    let receivedTimeout = 0;
    const result = await runHermesLandPortalLane(subject, {
      outputDirectory: directory,
      timeoutMs: 30 * 60_000,
      invokeHermes: async (_prompt, _directory, timeoutMs) => {
        receivedTimeout = timeoutMs;
        fs.writeFileSync(
          hermesLandPortalOutputFile(subject, directory),
          JSON.stringify({ subject_verification_status: 'no_match', subject_verification_note: 'Approved fallbacks exhausted.' }),
        );
      },
    });
    expect(receivedTimeout).toBe(HERMES_LANDPORTAL_HARD_TIMEOUT_MS);
    expect(result.status).toBe('no_match');
    expect(result.importResult).toBeNull();
  });

  it('uses an under-three-minute target cutoff by default', async () => {
    const subject = { ...input(), runId: 'default-target-cutoff' };
    const directory = tempDir();
    let receivedTimeout = 0;
    await runHermesLandPortalLane(subject, {
      outputDirectory: directory,
      invokeHermes: async (_prompt, _directory, timeoutMs) => {
        receivedTimeout = timeoutMs;
        fs.writeFileSync(
          hermesLandPortalOutputFile(subject, directory),
          JSON.stringify({ subject_verification_status: 'no_match', subject_verification_note: 'Approved fallbacks exhausted.' }),
        );
      },
    });
    expect(receivedTimeout).toBe(HERMES_LANDPORTAL_TARGET_RUNTIME_MS);
    expect(receivedTimeout).toBeLessThan(3 * 60_000);
  });

  it('imports only an exact-match JSON through the existing importer', async () => {
    const subject = input();
    const directory = tempDir();
    let importCalls = 0;
    const result = await runHermesLandPortalLane(subject, {
      outputDirectory: directory,
      invokeHermes: async () => {
        const output = hermesLandPortalOutputFile(subject, directory);
        fs.writeFileSync(output, JSON.stringify({
          subject_verification_status: 'verified_exact_subject',
          subject_verification_note: 'Address, APN, and parcel identifier agree.',
        }));
      },
      importFile: (file) => {
        importCalls += 1;
        expect(file).toBe(hermesLandPortalOutputFile(subject, directory));
        return importedResult(file);
      },
    });
    expect(result.status).toBe('exact_match');
    expect(result.importResult?.importedCompCount).toBe(3);
    expect(importCalls).toBe(1);
  });

  it('records context-only and no-match honestly without invoking the importer', async () => {
    for (const status of ['context_only', 'no_match'] as const) {
      resetHermesLandPortalLaneCache();
      const subject = { ...input(), runId: `run-${status}` };
      const directory = tempDir();
      let importCalls = 0;
      const result = await runHermesLandPortalLane(subject, {
        outputDirectory: directory,
        invokeHermes: async () => fs.writeFileSync(
          hermesLandPortalOutputFile(subject, directory),
          JSON.stringify({ subject_verification_status: status, subject_verification_note: `${status} returned.` }),
        ),
        importFile: (file) => { importCalls += 1; return importedResult(file); },
      });
      expect(result.status).toBe(status);
      expect(result.importResult).toBeNull();
      expect(importCalls).toBe(0);
    }
  });

  it('shares one launch and one import for duplicate callers in the same active run', async () => {
    const subject = input();
    const directory = tempDir();
    let invokeCalls = 0;
    let importCalls = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const deps = {
      outputDirectory: directory,
      invokeHermes: async () => {
        invokeCalls += 1;
        await gate;
        fs.writeFileSync(
          hermesLandPortalOutputFile(subject, directory),
          JSON.stringify({ subject_verification_status: 'verified_exact_subject' }),
        );
      },
      importFile: (file: string) => { importCalls += 1; return importedResult(file); },
    };
    const first = runHermesLandPortalLane(subject, deps);
    const duplicate = runHermesLandPortalLane(subject, deps);
    expect(first).toBe(duplicate);
    release();
    const [a, b] = await Promise.all([first, duplicate]);
    expect(a).toEqual(b);
    expect(invokeCalls).toBe(1);
    expect(importCalls).toBe(1);
  });

  it('fails closed when Hermes omits the required property-specific file', async () => {
    const directory = tempDir();
    const subject = input();
    const result = await runHermesLandPortalLane(subject, {
      outputDirectory: directory,
      invokeHermes: async () => {},
    });
    expect(result.status).toBe('failed');
    expect(result.note).toMatch(/without creating/i);
    expect(result.importResult).toBeNull();
    expect(JSON.parse(fs.readFileSync(hermesLandPortalOutputFile(subject, directory), 'utf8'))).toMatchObject({
      subject_verification_status: 'failed',
      address: subject.address,
      apn: subject.apn,
      property_card_id: subject.propertyCardId,
      comps: [],
    });
  });

  it('writes a concise failed handback when the bounded Hermes process is terminated', async () => {
    const directory = tempDir();
    const subject = { ...input(), runId: 'terminated-run' };
    const result = await runHermesLandPortalLane(subject, {
      outputDirectory: directory,
      timeoutMs: 125,
      invokeHermes: async () => { throw Object.assign(new Error('Command failed: full prompt must not persist'), { killed: true, signal: 'SIGTERM' }); },
    });
    const handback = JSON.parse(fs.readFileSync(result.outputFile, 'utf8')) as { subject_verification_note: string };
    expect(result.status).toBe('failed');
    expect(result.note).toBe('Hermes LandPortal execution exceeded the 125 ms lane limit.');
    expect(handback.subject_verification_note).toBe(result.note);
    expect(handback.subject_verification_note).not.toContain('full prompt');
  });
});
