import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { previewNextCall, recordCall, loadTrialState, REALIE_TRIAL } from './realie-trial-guard.js';

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'realie-trial-'));
  return path.join(dir, 'counter.json');
}

describe('Realie trial guard — manual, local, no network', () => {
  it('fresh state reflects the approved limit and zero calls', () => {
    const f = tmpFile();
    const s = loadTrialState(f);
    expect(s.approvedLimit).toBe(REALIE_TRIAL.approvedLimit); // 15
    expect(s.callsMade).toBe(0);
    expect(s.records).toEqual([]);
  });

  it('preview computes call number + remaining without incrementing', () => {
    const f = tmpFile();
    const p = previewNextCall({ endpoint: '/public/property/parcelId/', identifier: 'parcelId:123', mayConsumeCredit: true }, f);
    expect(p.callNumber).toBe(1);
    expect(p.approvedLimit).toBe(15);
    expect(p.remainingApproved).toBe(15);
    expect(p.allowed).toBe(true);
    // preview must not have written/incremented
    expect(loadTrialState(f).callsMade).toBe(0);
  });

  it('recordCall increments, persists, and never stores secrets', () => {
    const f = tmpFile();
    const r1 = recordCall({ endpoint: '/public/property/parcelId/', identifierType: 'parcelId', success: true, now: () => '2026-06-26T00:00:00Z' }, f);
    expect(r1.remainingApproved).toBe(14);
    const r2 = recordCall({ endpoint: '/public/property/address/', identifierType: 'address', success: false, now: () => '2026-06-26T00:01:00Z' }, f);
    expect(r2.remainingApproved).toBe(13);
    const s = loadTrialState(f);
    expect(s.callsMade).toBe(2);
    expect(s.records).toHaveLength(2);
    expect(s.records[0]).toMatchObject({ endpoint: '/public/property/parcelId/', identifierType: 'parcelId', success: true });
    // no key / response body fields persisted
    const raw = fs.readFileSync(f, 'utf-8');
    expect(raw).not.toMatch(/api[_-]?key|authorization|secret|property"\s*:/i);
  });

  it('blocks (allowed=false) once the approved budget is exhausted', () => {
    const f = tmpFile();
    for (let i = 0; i < 15; i++) recordCall({ endpoint: '/public/property/parcelId/', identifierType: 'parcelId', success: true }, f);
    const p = previewNextCall({ endpoint: '/public/property/parcelId/', identifier: 'parcelId:over', mayConsumeCredit: true }, f);
    expect(p.remainingApproved).toBe(0);
    expect(p.allowed).toBe(false);
  });
});
