import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runFiveLeadSimulation } from './phase1-five-lead-simulation.js';

interface FakeOpportunity {
  id: number;
  publicUid: string;
  lifecycle: string;
  disposition: string | null;
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

function fakeRuntime(profile: { mode: string; syntheticOnly: boolean } = { mode: 'qa', syntheticOnly: true }) {
  let nextOpportunity = 100;
  let nextTranscript = 500;
  let nextReconciliation = 800;
  let mutations = 0;
  const opportunities = new Map<number, FakeOpportunity>();
  const transcripts = new Map<number, Array<{ id: number; sourceType: 'paste' | 'upload' }>>();
  const reconciliations = new Map<number, Record<string, unknown>>();
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input.toString() : input.url);
    const route = url.pathname;
    if (route === '/api/landos/storage-profile') return json(profile);
    if (route === '/api/landos/leads/manual' && init?.method === 'POST') {
      mutations += 1;
      const id = nextOpportunity++;
      const opportunity = { id, publicUid: `opp_synthetic_${id}`, lifecycle: 'lead', disposition: null };
      opportunities.set(id, opportunity);
      return json({ opportunityId: id, publicUid: opportunity.publicUid }, 201);
    }
    const opportunityMatch = /^\/api\/landos\/opportunities\/(\d+)$/.exec(route);
    if (opportunityMatch) {
      const opportunity = opportunities.get(Number(opportunityMatch[1]));
      return opportunity ? json({ opportunity }) : json({ error: 'opportunity not found' }, 404);
    }
    const match = /^\/api\/landos\/opportunities\/(\d+)\/(transcripts|reconciliation|decision)$/.exec(route);
    if (!match) return json({ error: 'not found' }, 404);
    const id = Number(match[1]);
    const opportunity = opportunities.get(id);
    if (!opportunity) return json({ error: 'opportunity not found' }, 404);
    if (match[2] === 'transcripts' && init?.method === 'POST') {
      mutations += 1;
      const sourceType = init.body instanceof FormData ? 'upload' as const : 'paste' as const;
      const transcript = { id: nextTranscript++, sourceType };
      const reconciliation = {
        id: nextReconciliation++, transcriptId: transcript.id, version: 1,
        researchTasks: [{ title: 'Verify acreage' }], followUpTasks: [{ title: 'Confirm authority' }],
        nextAction: 'more_research',
        safety: { outboundAllowed: false, paidActionsAllowed: false, offerOrContractSendingAllowed: false },
      };
      transcripts.set(id, [transcript]);
      reconciliations.set(id, reconciliation);
      return json({ transcript, reconciliation, opportunity }, 201);
    }
    if (match[2] === 'transcripts') return json({ transcripts: transcripts.get(id) ?? [] });
    if (match[2] === 'reconciliation') return json({ reconciliation: reconciliations.get(id) });
    if (match[2] === 'decision' && init?.method === 'POST') {
      mutations += 1;
      const body = JSON.parse(String(init.body)) as { decision: string; disposition?: string };
      opportunity.lifecycle = body.decision === 'pursue' ? 'deal' : 'disposed';
      opportunity.disposition = body.disposition ?? null;
      return json({ opportunity });
    }
    return json({ error: 'not found' }, 404);
  };
  return { fetchImpl: fetchImpl as typeof fetch, mutationCount: () => mutations };
}

describe('Phase 1 five-lead simulation', () => {
  let root: string;
  let operatingDatabasePath: string;
  const priorMode = process.env.LANDOS_STORAGE_MODE;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'landos-five-lead-'));
    operatingDatabasePath = path.join(root, 'operating.db');
    fs.writeFileSync(operatingDatabasePath, 'immutable operating database fixture');
    process.env.LANDOS_STORAGE_MODE = 'qa';
  });

  afterEach(() => {
    if (priorMode === undefined) delete process.env.LANDOS_STORAGE_MODE;
    else process.env.LANDOS_STORAGE_MODE = priorMode;
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('runs five unique HTTP workflows, mixes paste/upload, proves owner decisions, and emits redacted evidence', async () => {
    const runtime = fakeRuntime();
    const report = await runFiveLeadSimulation({
      token: 'test-token', fetchImpl: runtime.fetchImpl,
      projectRoot: root, operatingDatabasePath, reportRoot: path.join(root, 'reports'),
    });

    expect(report.outcome).toBe('pass');
    expect(report.leads).toHaveLength(5);
    expect(new Set(report.leads.map((lead) => lead.opportunityId)).size).toBe(5);
    expect(report.leads.map((lead) => lead.transcriptSource)).toEqual(['paste', 'upload', 'paste', 'upload', 'paste']);
    expect(report.leads.every((lead) => lead.lifecycleBeforeOwnerDecision === 'lead')).toBe(true);
    expect(new Set(report.leads.map((lead) => lead.finalDisposition).filter(Boolean)).size).toBe(4);
    expect(report.assertions).toEqual(expect.objectContaining({
      fiveUniqueOpportunities: true, transcriptsAndReconciliations: true,
      tasksAndActions: true, variedDispositions: true, noAutomaticPursuit: true, safetyEnforced: true,
    }));
    expect(report.operatingDatabase.unchanged).toBe(true);
    expect(runtime.mutationCount()).toBe(15);
    const proof = fs.readFileSync(report.reportJsonPath!, 'utf8');
    expect(proof).not.toContain('Synthetic Simulation Seller');
    expect(proof).not.toContain('test-token');
    expect(proof).not.toContain('asking price');
  });

  it('refuses before HTTP when the simulator process is not in QA mode', async () => {
    process.env.LANDOS_STORAGE_MODE = 'operating';
    const runtime = fakeRuntime();
    await expect(runFiveLeadSimulation({ token: 'test-token', fetchImpl: runtime.fetchImpl, projectRoot: root, operatingDatabasePath }))
      .rejects.toThrow(/LANDOS_STORAGE_MODE=qa/);
    expect(runtime.mutationCount()).toBe(0);
  });

  it('records failure and makes no mutations when localhost does not report QA synthetic-only storage', async () => {
    const runtime = fakeRuntime({ mode: 'operating', syntheticOnly: false });
    const report = await runFiveLeadSimulation({
      token: 'test-token', fetchImpl: runtime.fetchImpl,
      projectRoot: root, operatingDatabasePath, reportRoot: path.join(root, 'reports'),
    });
    expect(report.outcome).toBe('fail');
    expect(report.error).toMatch(/live localhost runtime is not QA/);
    expect(runtime.mutationCount()).toBe(0);
    expect(report.operatingDatabase.unchanged).toBe(true);
  });

  it('rejects non-local simulation endpoints', async () => {
    const runtime = fakeRuntime();
    await expect(runFiveLeadSimulation({
      token: 'test-token', baseUrl: 'https://example.com', fetchImpl: runtime.fetchImpl,
      projectRoot: root, operatingDatabasePath,
    })).rejects.toThrow(/localhost/);
    expect(runtime.mutationCount()).toBe(0);
  });
});
