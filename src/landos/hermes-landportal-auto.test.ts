import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  HERMES_LANDPORTAL_CDP_SKILL,
  HERMES_LANDPORTAL_CONTEXT_SKILL,
  HERMES_LANDPORTAL_COMPS_HARD_TIMEOUT_MS,
  HERMES_LANDPORTAL_COMPS_TARGET_RUNTIME_MS,
  HERMES_LANDPORTAL_HARD_TIMEOUT_MS,
  HERMES_LANDPORTAL_VISUALS_HARD_TIMEOUT_MS,
  HERMES_LANDPORTAL_VISUALS_TARGET_RUNTIME_MS,
  HERMES_LANDPORTAL_PROFILE,
  HERMES_LANDPORTAL_SPECIALISTS,
  HERMES_LANDPORTAL_TARGET_RUNTIME_MS,
  getHermesLandPortalLaneProgress,
  hermesLandPortalInvocationArgs,
  hermesLandPortalPrompt,
  hermesLandPortalSpecialistOutputFile,
  resetHermesLandPortalLaneCache,
  runHermesLandPortalLane,
  type HermesLandPortalLaneInput,
  type HermesLandPortalSpecialist,
} from './hermes-landportal-auto.js';
import type {
  HermesLandPortalImportResult,
  HermesLandPortalValidatedIdentity,
} from './hermes-landportal-import.js';

const SUBJECT_URL = 'https://landportal.com/?property=exact-subject';

const input = (): HermesLandPortalLaneInput => ({
  runId: 'deal-intelligence-run-91',
  dealCardId: 91,
  propertyCardId: 109,
  address: '0 SOUTHARD RD, CATO, NY 13033',
  apn: '053289 47.00-1-6',
  owner: 'TEST OWNER',
  county: 'Cayuga',
  state: 'NY',
  landPortalPropertyId: '89500001',
});

function exactPayload(specialist: HermesLandPortalSpecialist, subjectUrl = SUBJECT_URL) {
  return {
    specialist_category: specialist,
    subject_verification_status: 'verified_exact_subject',
    subject_verification_note: `${specialist} exact identity verified.`,
    subject_url: subjectUrl,
    address: input().address,
    apn: input().apn,
    canonical_property_identifier: subjectUrl === SUBJECT_URL ? '89500001' : 'DIFFERENT',
    property_card_id: input().propertyCardId,
    completed_categories: [specialist],
    comps: specialist === 'comps' ? [{ price: 100000, acres: 10, apn: 'COMP-1' }] : [],
    visual_artifacts: [],
  };
}

function identityFor(file: string): HermesLandPortalValidatedIdentity {
  const value = JSON.parse(fs.readFileSync(file, 'utf8')) as ReturnType<typeof exactPayload>;
  return {
    address: value.address,
    apn: value.apn!,
    subjectUrl: value.subject_url,
    propertyId: value.canonical_property_identifier,
    fips: '36011',
    propertyCardId: 109,
    dealCardId: 91,
    specialistCategory: value.specialist_category,
    completedCategories: value.completed_categories,
    checks: [],
  };
}

function importedResult(file: string, specialist: HermesLandPortalSpecialist, persistedAt = new Date().toISOString()): HermesLandPortalImportResult {
  const itemCount = specialist === 'subject' ? 12 : specialist === 'comps' ? 1 : 1;
  return {
    imported: true,
    runId: `hermes-import-109-${specialist}`,
    sourceFile: file,
    sourceUrl: SUBJECT_URL,
    capturedAt: persistedAt,
    captureTimestampSource: 'json',
    propertyCardId: 109,
    dealCardId: 91,
    validationChecks: [],
    importedSubjectFields: specialist === 'subject' ? ['owner', 'deeded_acres'] : [],
    importedCompCount: specialist === 'comps' ? 1 : 0,
    createdCompCount: specialist === 'comps' ? 1 : 0,
    duplicateCompCount: 0,
    rejectedFields: [],
    canonicalEvidenceRetained: 1,
    completedCategories: [specialist],
    persistedCategories: [specialist],
    importedVisualCount: specialist === 'visuals' ? 1 : 0,
    rejectedVisualCount: 0,
    categoryResults: [{
      category: specialist,
      runId: `${specialist}-run`,
      imported: true,
      persistedAt,
      retainedEvidenceCount: 1,
      itemCount,
      rejectedItemCount: 0,
      error: null,
    }],
  };
}

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

describe('controlled Hermes LandPortal specialists', () => {
  it('uses the dedicated profile and emits three distinct address-first work units', () => {
    const subject = input();
    const files = HERMES_LANDPORTAL_SPECIALISTS.map((specialist) => hermesLandPortalSpecialistOutputFile(subject, specialist, 'C:\\hermes\\shared'));
    expect(files.map((file) => path.basename(file))).toEqual(['subject.json', 'comps.json', 'visuals.json']);
    expect(new Set(files.map((file) => path.basename(path.dirname(file))))).toEqual(new Set([
      '0-southard-rd-cato-ny-13033__property-card-109__deal-intelligence-run-91',
    ]));
    for (const specialist of HERMES_LANDPORTAL_SPECIALISTS) {
      const prompt = hermesLandPortalPrompt(subject, files[HERMES_LANDPORTAL_SPECIALISTS.indexOf(specialist)], specialist);
      expect(prompt).toContain(subject.address);
      expect(prompt).toContain(`"specialist_category": "${specialist}"`);
      expect(prompt).toContain('independent_specialist');
      expect(prompt).toContain(HERMES_LANDPORTAL_CONTEXT_SKILL);
      expect(prompt).toContain(HERMES_LANDPORTAL_CDP_SKILL);
      expect(prompt).toContain('Do not wait for sibling specialists');
      expect(prompt.length).toBeLessThan(2_500);
    }
    expect(hermesLandPortalInvocationArgs('lookup')).toEqual([
      '--profile', HERMES_LANDPORTAL_PROFILE,
      '--skills', `${HERMES_LANDPORTAL_CDP_SKILL},${HERMES_LANDPORTAL_CONTEXT_SKILL}`,
      '--oneshot', 'lookup',
    ]);
  });

  it('launches all three work units concurrently and caps each at the hard ceiling', async () => {
    const directory = tempDir();
    const started: HermesLandPortalSpecialist[] = [];
    const timeouts: number[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const run = runHermesLandPortalLane({ ...input(), runId: 'concurrent-cap' }, {
      outputDirectory: directory,
      timeoutMs: 30 * 60_000,
      invokeHermes: async (_prompt, _directory, timeoutMs, invocation) => {
        started.push(invocation.specialist);
        timeouts.push(timeoutMs);
        await gate;
        fs.writeFileSync(invocation.outputFile, JSON.stringify({ subject_verification_status: 'no_match', subject_verification_note: 'No exact subject.' }));
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(new Set(started)).toEqual(new Set(HERMES_LANDPORTAL_SPECIALISTS));
    // Each specialist is capped at its OWN ceiling. Comps no longer shares the
    // subject's five minutes: its per-comparable drilldown was killed mid-work
    // at exactly that limit on 5170 Hwy 60, importing no LandPortal comps.
    expect(timeouts).toEqual([HERMES_LANDPORTAL_HARD_TIMEOUT_MS, HERMES_LANDPORTAL_COMPS_HARD_TIMEOUT_MS, HERMES_LANDPORTAL_VISUALS_HARD_TIMEOUT_MS]);
    expect(getHermesLandPortalLaneProgress(91)?.workUnits.every((unit) => unit.status === 'running')).toBe(true);
    release();
    const result = await run;
    expect(result.status).toBe('no_match');
  });

  it('uses the bounded default target independently for every specialist', async () => {
    const received: number[] = [];
    await runHermesLandPortalLane({ ...input(), runId: 'default-target' }, {
      outputDirectory: tempDir(),
      invokeHermes: async (_prompt, _directory, timeoutMs, invocation) => {
        received.push(timeoutMs);
        fs.writeFileSync(invocation.outputFile, JSON.stringify({ subject_verification_status: 'no_match' }));
      },
    });
    expect(received).toEqual([HERMES_LANDPORTAL_TARGET_RUNTIME_MS, HERMES_LANDPORTAL_COMPS_TARGET_RUNTIME_MS, HERMES_LANDPORTAL_VISUALS_TARGET_RUNTIME_MS]);
  });

  it('persists completed siblings while one specialist is delayed and then interrupted', async () => {
    const subject = { ...input(), runId: 'isolated-interruption' };
    const directory = tempDir();
    const importOrder: HermesLandPortalSpecialist[] = [];
    const run = runHermesLandPortalLane(subject, {
      outputDirectory: directory,
      monitorIntervalMs: 5,
      invokeHermes: async (_prompt, _directory, _timeout, invocation) => {
        if (invocation.specialist === 'subject') await new Promise((resolve) => setTimeout(resolve, 5));
        if (invocation.specialist === 'comps') await new Promise((resolve) => setTimeout(resolve, 35));
        if (invocation.specialist === 'visuals') {
          await new Promise((resolve) => setTimeout(resolve, 80));
          throw Object.assign(new Error('intentional visual interruption'), { killed: true, signal: 'SIGTERM' });
        }
        fs.writeFileSync(invocation.outputFile, JSON.stringify(exactPayload(invocation.specialist)));
      },
      validateFile: (file) => identityFor(file),
      importFile: (file) => {
        const specialist = (JSON.parse(fs.readFileSync(file, 'utf8')) as ReturnType<typeof exactPayload>).specialist_category;
        importOrder.push(specialist);
        return importedResult(file, specialist, `2026-08-02T15:00:0${importOrder.length}.000Z`);
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(getHermesLandPortalLaneProgress(91)).toMatchObject({
      status: 'running',
      persistedCategories: [{ category: 'subject' }],
    });
    const result = await run;
    expect(importOrder).toEqual(['subject', 'comps']);
    expect(result.status).toBe('exact_match');
    expect(result.persistedCategories.map((category) => category.category)).toEqual(['subject', 'comps']);
    expect(result.workUnits).toEqual(expect.arrayContaining([
      expect.objectContaining({ specialist: 'subject', status: 'exact_match', persistedCategory: expect.objectContaining({ category: 'subject' }) }),
      expect.objectContaining({ specialist: 'comps', status: 'exact_match', persistedCategory: expect.objectContaining({ category: 'comps' }) }),
      expect.objectContaining({ specialist: 'visuals', status: 'failed', persistedCategory: null }),
    ]));
  });

  it('rejects a conflicting sibling identity without retracting an admitted category', async () => {
    const directory = tempDir();
    const imports: HermesLandPortalSpecialist[] = [];
    const result = await runHermesLandPortalLane({ ...input(), runId: 'identity-conflict' }, {
      outputDirectory: directory,
      invokeHermes: async (_prompt, _directory, _timeout, invocation) => {
        if (invocation.specialist === 'comps') await new Promise((resolve) => setTimeout(resolve, 20));
        if (invocation.specialist === 'visuals') {
          fs.writeFileSync(invocation.outputFile, JSON.stringify({ subject_verification_status: 'no_match' }));
          return;
        }
        const url = invocation.specialist === 'comps' ? 'https://landportal.com/?property=conflicting-subject' : SUBJECT_URL;
        fs.writeFileSync(invocation.outputFile, JSON.stringify(exactPayload(invocation.specialist, url)));
      },
      validateFile: (file) => identityFor(file),
      importFile: (file) => {
        const specialist = (JSON.parse(fs.readFileSync(file, 'utf8')) as ReturnType<typeof exactPayload>).specialist_category;
        imports.push(specialist);
        return importedResult(file, specialist);
      },
    });
    expect(imports).toEqual(['subject']);
    expect(result.persistedCategories.map((category) => category.category)).toEqual(['subject']);
    expect(result.workUnits.find((unit) => unit.specialist === 'comps')).toMatchObject({
      status: 'failed',
      note: expect.stringMatching(/identity conflict rejected.*property identifier.*subject URL/i),
    });
  });

  it('reconciles LandPortal URL variants when their decoded parcel identity is exact', async () => {
    const directory = tempDir();
    const encoded = (value: string) => encodeURIComponent(Buffer.from(value).toString('base64'));
    const subjectUrl = `https://landportal.com/?property=${encoded('fips=36011&apn=053289+47.00-1-6&propertyid=89500001&mls_propertyid=73200001')}`;
    const equivalentUrl = `https://landportal.com/?property=${encoded('fips=36011&apn=053289+47.00-1-6&propertyid=89500001')}`;
    const imports: HermesLandPortalSpecialist[] = [];
    const result = await runHermesLandPortalLane({ ...input(), runId: 'equivalent-url-variants' }, {
      outputDirectory: directory,
      invokeHermes: async (_prompt, _directory, _timeout, invocation) => {
        if (invocation.specialist === 'visuals') {
          fs.writeFileSync(invocation.outputFile, JSON.stringify({ subject_verification_status: 'no_match' }));
          return;
        }
        const url = invocation.specialist === 'subject' ? subjectUrl : equivalentUrl;
        fs.writeFileSync(invocation.outputFile, JSON.stringify({
          ...exactPayload(invocation.specialist, url),
          canonical_property_identifier: '89500001',
        }));
      },
      validateFile: (file) => identityFor(file),
      importFile: (file) => {
        const specialist = (JSON.parse(fs.readFileSync(file, 'utf8')) as ReturnType<typeof exactPayload>).specialist_category;
        imports.push(specialist);
        return importedResult(file, specialist);
      },
    });
    expect(imports).toEqual(['subject', 'comps']);
    expect(result.persistedCategories.map((category) => category.category)).toEqual(['subject', 'comps']);
  });

  it('shares one three-specialist launch for duplicate callers in the same active run', async () => {
    const directory = tempDir();
    let invokeCalls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const deps = {
      outputDirectory: directory,
      invokeHermes: async (_prompt: string, _directory: string, _timeout: number, invocation: { outputFile: string }) => {
        invokeCalls += 1;
        await gate;
        fs.writeFileSync(invocation.outputFile, JSON.stringify({ subject_verification_status: 'no_match' }));
      },
    };
    const subject = { ...input(), runId: 'duplicate-callers' };
    const first = runHermesLandPortalLane(subject, deps);
    const duplicate = runHermesLandPortalLane(subject, deps);
    expect(first).toBe(duplicate);
    release();
    const [a, b] = await Promise.all([first, duplicate]);
    expect(a).toEqual(b);
    expect(invokeCalls).toBe(3);
  });

  it('fails each missing or terminated work unit closed with concise property-scoped handbacks', async () => {
    const directory = tempDir();
    const result = await runHermesLandPortalLane({ ...input(), runId: 'terminated-units' }, {
      outputDirectory: directory,
      timeoutMs: 125,
      invokeHermes: async (_prompt, _directory, _timeout, invocation) => {
        if (invocation.specialist === 'subject') return;
        throw Object.assign(new Error('Command failed: full prompt must not persist'), { killed: true, signal: 'SIGTERM' });
      },
    });
    expect(result.status).toBe('failed');
    expect(result.workUnits).toHaveLength(3);
    for (const unit of result.workUnits) {
      expect(unit.status).toBe('failed');
      const handback = JSON.parse(fs.readFileSync(unit.outputFile, 'utf8')) as Record<string, unknown>;
      expect(handback).toMatchObject({ address: input().address, apn: input().apn, specialist_category: unit.specialist });
      expect(String(handback.subject_verification_note)).not.toContain('full prompt');
    }
  });
});
