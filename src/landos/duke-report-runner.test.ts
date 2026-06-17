// Tests for the Duke Report mission-task runner bridge. Pure orchestration with
// injected deps — no live LandPortal/agent calls, no comp credits, no secrets.

import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import { fileURLToPath } from 'url';

import {
  parseDukeReportTask,
  isDukeReportTask,
  stripSentinel,
  runDukeReportFromTask,
  type DukeReportRunDeps,
} from './duke-report-runner.js';

const sentinel = (compMode: string, cardId: number, approval: boolean) =>
  `[[duke_report v1 compMode=${compMode} cardId=${cardId} lpCompCreditApproval=${approval} source=dashboard]]`;

const task = (compMode: string, approval: boolean, body = 'Run a Duke Report on: APN 08-2518, Duplin, NC.') => ({
  id: 't1',
  assigned_agent: 'duke-due-diligence',
  prompt: `${sentinel(compMode, 12, approval)}\n${body}`,
});

describe('parseDukeReportTask / isDukeReportTask', () => {
  it('parses comp mode, card id, and approval', () => {
    const m = parseDukeReportTask(task('landportal_credit', true).prompt)!;
    expect(m.type).toBe('duke_report');
    expect(m.compMode).toBe('landportal_credit');
    expect(m.cardId).toBe(12);
    expect(m.lpCompCreditApproval).toBe(true);
  });

  it('Redfin/Zillow can never carry a comp-credit approval (even if flag is true)', () => {
    const m = parseDukeReportTask(task('redfin_zillow', true).prompt)!;
    expect(m.compMode).toBe('redfin_zillow');
    expect(m.lpCompCreditApproval).toBe(false);
  });

  it('LandPortal Comps without explicit true approval is not approved', () => {
    expect(parseDukeReportTask(task('landportal_credit', false).prompt)!.lpCompCreditApproval).toBe(false);
  });

  it('returns null for a non-Duke-Report prompt', () => {
    expect(parseDukeReportTask('just a normal mission prompt')).toBeNull();
  });

  it('isDukeReportTask requires the Duke agent AND the sentinel', () => {
    expect(isDukeReportTask(task('redfin_zillow', false))).toBe(true);
    expect(isDukeReportTask({ assigned_agent: 'main', prompt: task('redfin_zillow', false).prompt })).toBe(false);
    expect(isDukeReportTask({ assigned_agent: 'duke-due-diligence', prompt: 'no sentinel here' })).toBe(false);
  });

  it('stripSentinel removes the header so Duke sees clean text', () => {
    expect(stripSentinel(task('redfin_zillow', false).prompt)).toMatch(/^Run a Duke Report/);
    expect(stripSentinel(task('redfin_zillow', false).prompt)).not.toMatch(/duke_report v1/);
  });
});

function makeDeps(overrides: Partial<DukeReportRunDeps> & { calls?: string[] } = {}): DukeReportRunDeps {
  const calls = overrides.calls ?? [];
  return {
    // Default verified preflight excludes LandPortal from the filtered allowlist.
    runDukePreflight: overrides.runDukePreflight ?? (async () => { calls.push('preflight'); return { type: 'verified', parcelBlock: '[PARCEL]', filteredMcpAllowlist: ['filesystem'] }; }),
    runAgent: overrides.runAgent ?? (async (_p: string, _allowlist?: string[]) => { calls.push('runAgent'); return { text: 'Duke verified report body', aborted: false }; }),
    persistDukeRunPostDelivery: overrides.persistDukeRunPostDelivery ?? (() => { calls.push('persist'); }),
    mcpAllowlist: ['landportal', 'filesystem'],
    timeoutMs: 120_000,
  };
}

describe('runDukeReportFromTask — verified path', () => {
  it('runs preflight, then Duke, then the standardized writeback (in that order)', async () => {
    const calls: string[] = [];
    const persist = vi.fn((_info: unknown) => { calls.push('persist'); });
    const deps = makeDeps({ calls, persistDukeRunPostDelivery: persist as any });
    const r = await runDukeReportFromTask(task('redfin_zillow', false), deps);
    expect(r.status).toBe('completed');
    expect(r.verified).toBe(true);
    expect(r.blocked).toBe(false);
    expect(r.reportStatus).toBe('partial');
    expect(calls).toEqual(['preflight', 'runAgent', 'persist']);
    expect(persist).toHaveBeenCalledOnce();
    expect((persist.mock.calls[0][0] as any).status).toBe('success');
    expect((persist.mock.calls[0][0] as any).agentId).toBe('duke-due-diligence');
  });

  it('passes the verified parcel block into the Duke run', async () => {
    const seen: string[] = [];
    const deps = makeDeps({ runAgent: async (p, _allowlist) => { seen.push(p); return { text: 'ok' }; } });
    await runDukeReportFromTask(task('redfin_zillow', false), deps);
    expect(seen[0]).toContain('[PARCEL]');
    expect(seen[0]).not.toContain('duke_report v1'); // sentinel stripped
  });

  it('runs Duke with the preflight-FILTERED allowlist (LandPortal excluded), not the original', async () => {
    let usedAllowlist: string[] | undefined = ['SENTINEL'];
    const deps = makeDeps({
      mcpAllowlist: ['landportal', 'filesystem'],
      runDukePreflight: async () => ({ type: 'verified', parcelBlock: '[PARCEL]', filteredMcpAllowlist: ['filesystem'] }),
      runAgent: async (_p, allowlist) => { usedAllowlist = allowlist; return { text: 'ok' }; },
    });
    await runDukeReportFromTask(task('redfin_zillow', false), deps);
    expect(usedAllowlist).toEqual(['filesystem']);
    expect(usedAllowlist).not.toContain('landportal');
  });

  it('does not fall back to the original unfiltered allowlist when preflight filters it', async () => {
    let usedAllowlist: string[] | undefined;
    const deps = makeDeps({
      mcpAllowlist: ['landportal', 'filesystem', 'web'],
      runDukePreflight: async () => ({ type: 'verified', parcelBlock: '[PARCEL]', filteredMcpAllowlist: [] }),
      runAgent: async (_p, allowlist) => { usedAllowlist = allowlist; return { text: 'ok' }; },
    });
    await runDukeReportFromTask(task('redfin_zillow', false), deps);
    // Preflight returned an empty filtered allowlist (parcel injected inline);
    // the runner passes exactly that, never the original unfiltered list.
    expect(usedAllowlist).toEqual([]);
  });
});

describe('runDukeReportFromTask — unverified blocks parcel-specific work', () => {
  it('blocked preflight => no writeback, Local Area Context labeled', async () => {
    const persist = vi.fn();
    const deps = makeDeps({
      runDukePreflight: async () => ({ type: 'blocked', message: 'Parcel not verified -- no scoring, valuation, or offer.', reason: 'not_verified' }),
      persistDukeRunPostDelivery: persist as any,
    });
    const r = await runDukeReportFromTask(task('redfin_zillow', false), deps);
    expect(r.status).toBe('completed');
    expect(r.verified).toBe(false);
    expect(r.blocked).toBe(true);
    expect(r.reportStatus).toBe('blocked');
    expect(r.summary).toMatch(/Local Area Context, Not Parcel Verified/);
    expect(persist).not.toHaveBeenCalled();
  });

  it('skip (no identifier) => no writeback, blocked', async () => {
    const persist = vi.fn();
    const deps = makeDeps({ runDukePreflight: async () => ({ type: 'skip' }), persistDukeRunPostDelivery: persist as any });
    const r = await runDukeReportFromTask(task('redfin_zillow', false), deps);
    expect(r.verified).toBe(false);
    expect(r.blocked).toBe(true);
    expect(persist).not.toHaveBeenCalled();
  });
});

describe('runDukeReportFromTask — comp credit + failures', () => {
  it('never reports a comp credit used (runner never spends); Redfin/Zillow has no approval', async () => {
    const r = await runDukeReportFromTask(task('redfin_zillow', true), makeDeps());
    expect(r.compMode).toBe('redfin_zillow');
    expect(r.lpCompCreditApproval).toBe(false);
    expect(r.compCreditUsed).toBe(false);
  });

  it('LandPortal Comps carries one-run approval but the runner still spends nothing', async () => {
    const r = await runDukeReportFromTask(task('landportal_credit', true), makeDeps());
    expect(r.compMode).toBe('landportal_credit');
    expect(r.lpCompCreditApproval).toBe(true);
    expect(r.compCreditUsed).toBe(false);
  });

  it('a preflight error fails the task without a writeback', async () => {
    const persist = vi.fn();
    const deps = makeDeps({ runDukePreflight: async () => { throw new Error('lp boom'); }, persistDukeRunPostDelivery: persist as any });
    const r = await runDukeReportFromTask(task('redfin_zillow', false), deps);
    expect(r.status).toBe('failed');
    expect(r.error).toBe('lp boom');
    expect(persist).not.toHaveBeenCalled();
  });

  it('an aborted verified run records timeout, still no fabricated success', async () => {
    const persist = vi.fn((_info: unknown) => {});
    const deps = makeDeps({ runAgent: async () => ({ text: '', aborted: true }), persistDukeRunPostDelivery: persist as any });
    const r = await runDukeReportFromTask(task('redfin_zillow', false), deps);
    expect(r.reportStatus).toBe('failed');
    expect((persist.mock.calls[0][0] as any).status).toBe('timeout');
  });

  it('emits no coordinate/proximity/geocoder language', async () => {
    const r = await runDukeReportFromTask(task('redfin_zillow', false), makeDeps({
      runDukePreflight: async () => ({ type: 'blocked', message: 'x', reason: 'y' }),
    }));
    expect(/geocod|proximity|nearest parcel|map pin|coordinate|centroid/i.test(JSON.stringify(r))).toBe(false);
  });
});

describe('scheduler routes Duke Report tasks through the runner (not generic runAgent)', () => {
  const SRC = fs.readFileSync(fileURLToPath(new URL('../scheduler.ts', import.meta.url)), 'utf-8');
  it('imports and branches on isDukeReportTask -> runDukeReportFromTask', () => {
    expect(SRC).toMatch(/import \{[^}]*isDukeReportTask[^}]*runDukeReportFromTask[^}]*\} from '\.\/landos\/duke-report-runner\.js'/);
    expect(SRC).toMatch(/if \(isDukeReportTask\(mission\)\)/);
    expect(SRC).toMatch(/runDukeReportFromTask\(mission/);
    expect(SRC).toMatch(/runDukePreflight,/);
    expect(SRC).toMatch(/persistDukeRunPostDelivery,/);
  });
  it('forwards the runner-supplied (preflight-filtered) allowlist into runAgent', () => {
    expect(SRC).toMatch(/runAgent:\s*\(p, allowlist\) =>/);
    expect(SRC).toMatch(/allowlist \?\? agentMcpAllowlist/);
  });
  it('keeps the generic runAgent path for non-Duke mission tasks', () => {
    expect(SRC).toMatch(/const result = await runAgent\(mission\.prompt/);
  });
});
