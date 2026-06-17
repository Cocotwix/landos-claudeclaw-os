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
  blockedPreflightToLanes,
  renderDukeUnverifiedTimeoutReport,
  type DukeReportRunDeps,
} from './duke-report-runner.js';
import { renderDukeReportLanes, LOCAL_AREA_NOT_VERIFIED_LABEL } from './duke-report-lanes.js';

// The exact thin one-line failure the live dashboard used to surface on timeout.
const RAW_TIMEOUT_MESSAGE =
  'LandPortal lookup did not respond in time. Parcel not verified -- no scoring, valuation, or offer. Retry the address, or provide APN + county for direct lookup.';
const laneById = (r: ReturnType<typeof blockedPreflightToLanes>, id: string) => r.lanes.find(l => l.laneId === id)!;

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

describe('blockedPreflightToLanes — LandPortal timeout returns Source Lanes, not the thin message', () => {
  // The live dashboard/chat path feeds a blocked timeout preflight here.
  const timeoutPre = {
    type: 'blocked' as const,
    message: RAW_TIMEOUT_MESSAGE,
    reason: 'lp_timeout',
  };
  const dukeText = 'Run a Duke Report on 731 Filter Plant Rd, Celina, Clay County, TN.';
  const r = blockedPreflightToLanes(timeoutPre, dukeText, 'redfin_zillow', 180_000);
  const rendered = renderDukeReportLanes(r);

  it('does not return the raw thin TIMEOUT_MESSAGE', () => {
    expect(rendered).not.toBe(RAW_TIMEOUT_MESSAGE);
    expect(r.summary).not.toBe(RAW_TIMEOUT_MESSAGE);
  });
  it('rendered report includes per-lane statuses', () => {
    expect(rendered).toMatch(/LandPortal Exact Search: timeout/);
    expect(rendered).toMatch(/Redfin\/Zillow Comps: blocked/);
    expect(rendered).toMatch(/Strategy \/ Offer: blocked/);
  });
  it('LandPortal lane status is timeout', () => {
    expect(laneById(r, 'landportal_exact_search').status).toBe('timeout');
  });
  it('Local Area Data lane contributes when a county/state anchor exists', () => {
    const la = laneById(r, 'local_area_data');
    expect(la.status).toBe('success');
    expect(la.findings.some(f => /Clay County, TN/.test(f))).toBe(true);
    expect(rendered).toMatch(/Clay County, TN/);
  });
  it('Local Area Data lane emits the compact market snapshot (growth + counts + sources)', () => {
    const f = laneById(r, 'local_area_data').findings.join('\n');
    expect(f).toMatch(/Annual growth: unavailable \| Source: unavailable from current default sources/);
    expect(f).toMatch(/Active land listings: unavailable/);
    expect(f).toMatch(/Active land listings source: unavailable from current default sources/);
    expect(f).toMatch(/Land sold last 6 months: unavailable/);
    expect(f).toMatch(/Land sold last 6 months source: unavailable from current default sources/);
    expect(f).toMatch(/Source status: not_available/);
  });
  it('does not emit the old "full Fast Default report" wording', () => {
    expect(rendered).not.toMatch(/full Fast Default report/i);
    expect(rendered).not.toMatch(/Want the full report/i);
  });
  it('final report includes exactly "Local Area Context, Not Parcel Verified"', () => {
    expect(r.unverifiedLabel).toBe(LOCAL_AREA_NOT_VERIFIED_LABEL);
    expect(rendered).toContain(LOCAL_AREA_NOT_VERIFIED_LABEL);
  });
  it('score/value/offer/strategy and Redfin/Zillow/LandWatch are blocked, not run', () => {
    expect(r.parcelVerified).toBe(false);
    expect(laneById(r, 'redfin_zillow_comps').status).toBe('blocked');
    expect(laneById(r, 'landwatch').status).toBe('blocked');
    expect(laneById(r, 'strategy_offer').status).toBe('blocked');
    expect(laneById(r, 'strategy_offer').findings).toEqual([]); // no offer/strategy numbers emitted
  });
  it('compCreditUsed remains false', () => {
    expect(r.compCreditUsed).toBe(false);
    expect(r.lanes.every(l => l.compCreditUsed === false)).toBe(true);
  });
  it('emits no coordinate/geocoder/proximity/map-pin/visual verification language', () => {
    expect(/geocod|proximity|nearest parcel|map pin|coordinate|centroid|street view|satellite/i.test(rendered)).toBe(false);
  });
  it('a skip outcome (no identifier) also yields the unverified Local Area report', () => {
    const sr = blockedPreflightToLanes({ type: 'skip' }, 'some area question', 'redfin_zillow');
    expect(sr.parcelVerified).toBe(false);
    expect(sr.unverifiedLabel).toBe(LOCAL_AREA_NOT_VERIFIED_LABEL);
    expect(sr.compCreditUsed).toBe(false);
  });
});

describe('blockedPreflightToLanes — zero-candidate / not-verified returns Source Lanes', () => {
  // The dashboard "skip"/no-match path: LandPortal returned no single parcel.
  const r = blockedPreflightToLanes(
    { type: 'blocked', message: 'Parcel not verified -- no scoring, valuation, or offer.', reason: 'not_verified' },
    'Owner: Cheryl Sann, Clay County, TN',
    'redfin_zillow',
  );
  const rendered = renderDukeReportLanes(r);
  it('renders the unverified Source Lanes, not the raw thin message', () => {
    expect(rendered).not.toBe(RAW_TIMEOUT_MESSAGE);
    expect(rendered).toContain(LOCAL_AREA_NOT_VERIFIED_LABEL);
    expect(laneById(r, 'landportal_exact_search').status).toBe('blocked');
  });
  it('blocks score/value/offer/strategy and uses 0 comp credits', () => {
    expect(r.parcelVerified).toBe(false);
    expect(laneById(r, 'strategy_offer').status).toBe('blocked');
    expect(laneById(r, 'redfin_zillow_comps').status).toBe('blocked');
    expect(r.compCreditUsed).toBe(false);
  });
});

describe('renderDukeUnverifiedTimeoutReport — live dashboard agent-timeout path', () => {
  // This is the path that actually emitted the bare one-line failure: the Duke
  // agent run aborts on the dashboard ceiling (preflight returned skip, so LP
  // MCP stayed available). The Cheryl Sann / Clay County TN case.
  const dukeText = 'Cheryl Sann\nAddress: 051   012.05 — Clay County, TN';
  const rendered = renderDukeUnverifiedTimeoutReport(dukeText, 'redfin_zillow', 120_000);

  it('NEVER returns the raw thin TIMEOUT_MESSAGE as the whole answer', () => {
    expect(rendered).not.toBe(RAW_TIMEOUT_MESSAGE);
    expect(rendered).not.toContain(RAW_TIMEOUT_MESSAGE);
  });
  it('leads with Local Area Context, Not Parcel Verified', () => {
    expect(rendered).toContain(LOCAL_AREA_NOT_VERIFIED_LABEL);
  });
  it('emits the LandPortal Exact Search lane as timed out', () => {
    expect(rendered).toMatch(/LandPortal Exact Search: timeout/);
  });
  it('emits the Verification Captain decision', () => {
    expect(rendered).toMatch(/Verification Captain:/);
  });
  it('emits the Local Area Data snapshot fields (growth + active + sold + sources)', () => {
    expect(rendered).toMatch(/Clay County, TN/);
    expect(rendered).toMatch(/Annual growth: unavailable \| Source: /);
    expect(rendered).toMatch(/Active land listings: unavailable/);
    expect(rendered).toMatch(/Active land listings source: /);
    expect(rendered).toMatch(/Land sold last 6 months: unavailable/);
    expect(rendered).toMatch(/Land sold last 6 months source: /);
  });
  it('runs no score, valuation, offer, or strategy recommendation', () => {
    expect(rendered).toMatch(/Redfin\/Zillow Comps: blocked/);
    expect(rendered).toMatch(/Strategy \/ Offer: blocked/);
    expect(rendered).not.toMatch(/Expected Value:\s*\$/);
    expect(rendered).not.toMatch(/offer of \$/i);
  });
  it('uses 0 comp credits', () => {
    expect(rendered).not.toMatch(/comp credit (used|spent)/i);
  });
  it('emits no coordinate/geocoder/proximity/map-pin/visual/satellite verification language', () => {
    expect(/geocod|proximity|nearest parcel|map pin|coordinate|centroid|street view|satellite/i.test(rendered)).toBe(false);
  });
});

describe('bot dashboard/chat path renders blocked preflight as Source Lanes', () => {
  const SRC = fs.readFileSync(fileURLToPath(new URL('../bot.ts', import.meta.url)), 'utf-8');
  it('imports the lane helpers and no longer emits the raw preflight.message on block', () => {
    expect(SRC).toMatch(/blockedPreflightToLanes/);
    expect(SRC).toMatch(/renderDukeReportLanes/);
    expect(SRC).not.toMatch(/content:\s*preflight\.message/);
  });
  it('routes the Duke agent-timeout abort branch through the canonical Source Lanes renderer', () => {
    expect(SRC).toMatch(/renderDukeUnverifiedTimeoutReport/);
  });
  it('no longer contains the raw one-line timeout sentence as a live string literal', () => {
    // The whole raw failure sentence must not exist anywhere in the live bot
    // source — it can only ever appear as an internal lane reason, never as a
    // returned string. duke-preflight owns the constant; bot.ts must not.
    expect(SRC).not.toContain('LandPortal lookup did not respond in time. Parcel not verified -- no scoring, valuation, or offer. Retry the address, or provide APN + county for direct lookup.');
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
