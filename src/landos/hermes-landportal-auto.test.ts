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
  getHermesLandPortalLaneProgress,
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
  completedCategories: ['subject', 'comps'],
  persistedCategories: ['subject', 'comps'],
  importedVisualCount: 0,
  rejectedVisualCount: 0,
  categoryResults: [
    { category: 'subject', runId: 'subject-run', imported: true, persistedAt: '2026-08-02T03:00:00.000Z', retainedEvidenceCount: 1, itemCount: 2, rejectedItemCount: 0, error: null },
    { category: 'comps', runId: 'comps-run', imported: true, persistedAt: '2026-08-02T03:00:01.000Z', retainedEvidenceCount: 1, itemCount: 3, rejectedItemCount: 0, error: null },
  ],
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

  it('uses a bounded target with shutdown margin inside the hard ceiling', async () => {
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
    expect(receivedTimeout).toBeLessThan(HERMES_LANDPORTAL_HARD_TIMEOUT_MS);
    expect(HERMES_LANDPORTAL_HARD_TIMEOUT_MS - receivedTimeout).toBeGreaterThanOrEqual(20_000);
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

  it('imports progressive subject and comp snapshots before a later interruption', async () => {
    const directory = tempDir();
    const subject = { ...input(), runId: 'progressive-then-interrupted' };
    const output = hermesLandPortalOutputFile(subject, directory);
    const importedCategories: string[][] = [];
    let subjectWasImportedBeforeComps = false;
    const progressiveResult = (categories: Array<'subject' | 'comps'>): HermesLandPortalImportResult => ({
      ...importedResult(output),
      importedCompCount: categories.includes('comps') ? 2 : 0,
      createdCompCount: categories.includes('comps') ? 2 : 0,
      completedCategories: categories,
      persistedCategories: categories,
      categoryResults: categories.map((category, index) => ({
        category,
        runId: `${category}-incremental-run`,
        imported: true,
        persistedAt: `2026-08-02T15:00:0${index + 1}.000Z`,
        retainedEvidenceCount: 1,
        itemCount: category === 'subject' ? 5 : 2,
        rejectedItemCount: 0,
        error: null,
      })),
    });

    const result = await runHermesLandPortalLane(subject, {
      outputDirectory: directory,
      timeoutMs: 150,
      monitorIntervalMs: 10,
      invokeHermes: async () => {
        fs.writeFileSync(output, JSON.stringify({
          subject_verification_status: 'verified_exact_subject',
          subject_verification_note: 'Exact identity verified.',
          completed_categories: ['subject'],
          comps: [],
        }));
        await new Promise((resolve) => setTimeout(resolve, 35));
        subjectWasImportedBeforeComps = importedCategories.length === 1 && importedCategories[0].join(',') === 'subject';
        fs.writeFileSync(output, JSON.stringify({
          subject_verification_status: 'verified_exact_subject',
          subject_verification_note: 'Exact identity and comps verified.',
          completed_categories: ['subject', 'comps'],
          comps: [{ price: 100000, acres: 10, apn: 'COMP-1' }, { price: 150000, acres: 15, apn: 'COMP-2' }],
        }));
        await new Promise((resolve) => setTimeout(resolve, 35));
        throw Object.assign(new Error('bounded interruption after comps'), { killed: true, signal: 'SIGTERM' });
      },
      importFile: (file) => {
        const snapshot = JSON.parse(fs.readFileSync(file, 'utf8')) as { completed_categories: Array<'subject' | 'comps'> };
        importedCategories.push(snapshot.completed_categories);
        return progressiveResult(snapshot.completed_categories);
      },
    });

    expect(subjectWasImportedBeforeComps).toBe(true);
    expect(importedCategories).toEqual([['subject'], ['subject', 'comps']]);
    expect(result.status).toBe('failed');
    expect(result.persistedCategories.map((category) => category.category)).toEqual(['subject', 'comps']);
    expect(result.importResults).toHaveLength(2);
    expect(getHermesLandPortalLaneProgress(subject.dealCardId)).toMatchObject({
      address: subject.address,
      status: 'failed',
      persistedCategories: [{ category: 'subject' }, { category: 'comps' }],
    });
    expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toMatchObject({
      subject_verification_status: 'verified_exact_subject',
      completed_categories: ['subject', 'comps'],
    });
  });
});
