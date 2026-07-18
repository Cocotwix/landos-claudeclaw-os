import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { PROJECT_ROOT, STORE_DIR } from '../config.js';
import { getLandosStorageProfile } from './storage-profile.js';

export interface FiveLeadSimulationOptions {
  baseUrl?: string;
  token: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  projectRoot?: string;
  operatingDatabasePath?: string;
  reportRoot?: string;
}

interface OpportunityShape {
  id: number;
  publicUid: string;
  lifecycle: string;
  disposition: string | null;
}

interface ReconciliationShape {
  id: number;
  transcriptId: number;
  version: number;
  researchTasks: unknown[];
  followUpTasks: unknown[];
  nextAction: string;
  safety: {
    outboundAllowed: boolean;
    paidActionsAllowed: boolean;
    offerOrContractSendingAllowed: boolean;
  };
}

export interface FiveLeadProof {
  ordinal: number;
  opportunityId: number;
  publicUid: string;
  transcriptId: number;
  transcriptSource: 'paste' | 'upload';
  reconciliationId: number;
  reconciliationVersion: number;
  researchTaskCount: number;
  followUpTaskCount: number;
  nextAction: string;
  lifecycleBeforeOwnerDecision: string;
  ownerDecision: 'pursue' | 'disposition';
  finalLifecycle: string;
  finalDisposition: string | null;
  safetyEnforced: boolean;
}

export interface FiveLeadSimulationReport {
  schemaVersion: 1;
  runId: string;
  startedAt: string;
  finishedAt: string;
  outcome: 'pass' | 'fail';
  baseUrl: string;
  storageProfile: { mode: string; syntheticOnly: boolean };
  redaction: { rawLeadDataIncluded: false; rawTranscriptsIncluded: false; tokenIncluded: false };
  operatingDatabase: { sha256Before: string; sha256After: string; unchanged: boolean };
  assertions: {
    fiveUniqueOpportunities: boolean;
    transcriptsAndReconciliations: boolean;
    tasksAndActions: boolean;
    variedDispositions: boolean;
    noAutomaticPursuit: boolean;
    safetyEnforced: boolean;
  };
  leads: FiveLeadProof[];
  error?: string;
  reportJsonPath?: string;
  reportMarkdownPath?: string;
}

const SCENARIOS = [
  { decision: 'pursue' as const, disposition: null, nextHint: 'Verify access and call the owner back Friday.' },
  { decision: 'disposition' as const, disposition: 'follow_up', nextHint: 'Call us back next week after verifying acreage.' },
  { decision: 'disposition' as const, disposition: 'nurture', nextHint: 'We are not ready; call us next year.' },
  { decision: 'disposition' as const, disposition: 'dead_lead', nextHint: 'The seller is not interested and considers this a dead lead.' },
  { decision: 'disposition' as const, disposition: 'do_not_contact', nextHint: 'Do not contact or call again.' },
] as const;

function sha256File(filePath: string): string {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function localBaseUrl(raw: string): string {
  const parsed = new URL(raw);
  if (parsed.protocol !== 'http:' || !['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) {
    throw new Error('Phase 1 simulation accepts only an HTTP localhost base URL');
  }
  return parsed.origin;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[?&]token=[^&\s]+/gi, '?token=[REDACTED]').slice(0, 1_000);
}

function markdown(report: FiveLeadSimulationReport): string {
  const lines = [
    '# LandOS Phase 1 Five-Lead Simulation', '',
    `- Outcome: **${report.outcome.toUpperCase()}**`,
    `- Run: \`${report.runId}\``,
    `- Window: ${report.startedAt} to ${report.finishedAt}`,
    `- Runtime: ${report.baseUrl} (${report.storageProfile.mode}, syntheticOnly=${report.storageProfile.syntheticOnly})`,
    `- Operating DB SHA-256 unchanged: ${report.operatingDatabase.unchanged} (\`${report.operatingDatabase.sha256Before}\`)`,
    '- Redaction: no raw lead data, transcript text, authentication token, or secret values are included.', '',
    '## Assertions', '',
    ...Object.entries(report.assertions).map(([key, value]) => `- ${key}: ${value ? 'PASS' : 'FAIL'}`), '',
    '## Synthetic opportunity proofs', '',
    '| # | Opportunity | Transcript | Reconciliation | Tasks | Next action | Pre-decision | Owner decision | Final |',
    '|---:|---|---|---:|---:|---|---|---|---|',
    ...report.leads.map((lead) => `| ${lead.ordinal} | ${lead.publicUid} | ${lead.transcriptSource} #${lead.transcriptId} | v${lead.reconciliationVersion} | ${lead.researchTaskCount + lead.followUpTaskCount} | ${lead.nextAction} | ${lead.lifecycleBeforeOwnerDecision} | ${lead.ownerDecision}${lead.finalDisposition ? `:${lead.finalDisposition}` : ''} | ${lead.finalLifecycle} |`),
  ];
  if (report.error) lines.push('', '## Failure', '', safeError(report.error));
  return `${lines.join('\n')}\n`;
}

export async function runFiveLeadSimulation(options: FiveLeadSimulationOptions): Promise<FiveLeadSimulationReport> {
  if (process.env.LANDOS_STORAGE_MODE !== 'qa') {
    throw new Error('Refusing mutation: set LANDOS_STORAGE_MODE=qa for the simulator process');
  }
  const localProfile = getLandosStorageProfile();
  assert(localProfile.mode === 'qa' && localProfile.syntheticOnly, 'local LandOS storage profile is not isolated QA/synthetic-only');
  assert(options.token.trim(), 'DASHBOARD_TOKEN is required');

  const baseUrl = localBaseUrl(options.baseUrl ?? 'http://localhost:3141');
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());
  const projectRoot = path.resolve(options.projectRoot ?? PROJECT_ROOT);
  const operatingDatabasePath = path.resolve(options.operatingDatabasePath ?? path.join(STORE_DIR, 'landos.db'));
  const reportRoot = path.resolve(options.reportRoot ?? path.join(projectRoot, '.runtime', 'landos', 'phase1-simulations'));
  assert(fs.existsSync(operatingDatabasePath), 'operating LandOS database is missing; cannot prove isolation');
  const operatingBefore = sha256File(operatingDatabasePath);
  const started = now();
  const runId = `phase1-five-lead-${started.toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const leads: FiveLeadProof[] = [];
  let liveProfile = { mode: 'unknown', syntheticOnly: false };

  const request = async <T>(apiPath: string, init?: RequestInit): Promise<T> => {
    const url = new URL(apiPath, `${baseUrl}/`);
    url.searchParams.set('token', options.token);
    const response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(20_000) });
    const text = await response.text();
    let body: unknown;
    try { body = JSON.parse(text); } catch { body = null; }
    if (!response.ok) throw new Error(`${init?.method ?? 'GET'} ${url.pathname} returned ${response.status}`);
    return body as T;
  };

  let failure: string | undefined;
  try {
    liveProfile = await request<{ mode: string; syntheticOnly: boolean }>('/api/landos/storage-profile');
    assert(liveProfile.mode === 'qa' && liveProfile.syntheticOnly === true,
      'refusing mutation: live localhost runtime is not QA/syntheticOnly');

    for (let index = 0; index < SCENARIOS.length; index += 1) {
      const ordinal = index + 1;
      const scenario = SCENARIOS[index];
      const lead = await request<{ opportunityId: number; publicUid: string }>('/api/landos/leads/manual', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sellerName: `Synthetic Simulation Seller ${ordinal}`,
          address: `${9000 + ordinal} Phase One Simulation Way, Testville, NC`,
          county: 'Test County', state: 'NC', acreage: String(10 + ordinal),
          leadSource: 'phase1-five-lead-simulation',
          sellerClues: 'Synthetic QA fixture only. Identity and seller statements require verification.',
        }),
      });
      assert(Number.isInteger(lead.opportunityId) && /^opp_/.test(lead.publicUid), `lead ${ordinal} did not return a durable opportunity`);

      const transcript = `Synthetic QA discovery call ${ordinal}. Seller says the property is ${10 + ordinal}.5 acres with road access. The asking price is $${50_000 + ordinal * 4_000}. They inherited the land and want to sell within ${20 + ordinal} days. ${scenario.nextHint}`;
      let result: { transcript: { id: number; sourceType: 'paste' | 'upload' }; reconciliation: ReconciliationShape; opportunity: OpportunityShape };
      if (ordinal % 2 === 0) {
        const form = new FormData();
        form.set('actor', 'owner');
        form.set('file', new File([transcript], `synthetic-simulation-${ordinal}.txt`, { type: 'text/plain' }));
        result = await request(`/api/landos/opportunities/${lead.opportunityId}/transcripts`, { method: 'POST', body: form });
      } else {
        result = await request(`/api/landos/opportunities/${lead.opportunityId}/transcripts`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ content: transcript, sourceType: 'paste', actor: 'owner' }),
        });
      }
      const beforeDecision = result.opportunity;
      const reconciliation = result.reconciliation;
      assert(beforeDecision.lifecycle === 'lead', `opportunity ${lead.opportunityId} was automatically pursued`);
      assert(reconciliation?.id && reconciliation.transcriptId === result.transcript.id, `opportunity ${lead.opportunityId} lacks linked reconciliation`);
      assert(Array.isArray(reconciliation.researchTasks) && Array.isArray(reconciliation.followUpTasks), `opportunity ${lead.opportunityId} lacks reconciliation tasks`);
      assert(reconciliation.researchTasks.length + reconciliation.followUpTasks.length > 0, `opportunity ${lead.opportunityId} generated no task`);
      assert(typeof reconciliation.nextAction === 'string' && reconciliation.nextAction.length > 0, `opportunity ${lead.opportunityId} lacks a next action`);
      assert(reconciliation.safety?.outboundAllowed === false && reconciliation.safety.paidActionsAllowed === false && reconciliation.safety.offerOrContractSendingAllowed === false,
        `opportunity ${lead.opportunityId} reconciliation violated Phase 1 safety`);

      const decisionBody = scenario.decision === 'pursue'
        ? { decision: 'pursue' }
        : { decision: 'disposition', disposition: scenario.disposition };
      const decision = await request<{ opportunity: OpportunityShape }>(`/api/landos/opportunities/${lead.opportunityId}/decision`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(decisionBody),
      });
      const persistedTranscripts = await request<{ transcripts: Array<{ id: number }> }>(`/api/landos/opportunities/${lead.opportunityId}/transcripts`);
      const persistedReconciliation = await request<{ reconciliation: ReconciliationShape }>(`/api/landos/opportunities/${lead.opportunityId}/reconciliation`);
      const persistedOpportunity = await request<{ opportunity: OpportunityShape }>(`/api/landos/opportunities/${lead.opportunityId}`);
      assert(persistedTranscripts.transcripts.some((item) => item.id === result.transcript.id), 'transcript was not durable');
      assert(persistedReconciliation.reconciliation.id === reconciliation.id, 'latest reconciliation did not persist');
      assert(persistedOpportunity.opportunity.lifecycle === decision.opportunity.lifecycle
        && persistedOpportunity.opportunity.disposition === decision.opportunity.disposition, 'owner decision did not persist');
      if (scenario.decision === 'pursue') {
        assert(persistedOpportunity.opportunity.lifecycle === 'deal' && persistedOpportunity.opportunity.disposition === null,
          'owner pursue decision did not produce a Deal Card lifecycle');
      } else {
        assert(persistedOpportunity.opportunity.lifecycle === 'disposed' && persistedOpportunity.opportunity.disposition === scenario.disposition,
          `owner disposition ${scenario.disposition} did not persist exactly`);
      }

      leads.push({
        ordinal, opportunityId: lead.opportunityId, publicUid: lead.publicUid,
        transcriptId: result.transcript.id, transcriptSource: result.transcript.sourceType,
        reconciliationId: reconciliation.id, reconciliationVersion: reconciliation.version,
        researchTaskCount: reconciliation.researchTasks.length, followUpTaskCount: reconciliation.followUpTasks.length,
        nextAction: reconciliation.nextAction, lifecycleBeforeOwnerDecision: beforeDecision.lifecycle,
        ownerDecision: scenario.decision, finalLifecycle: persistedOpportunity.opportunity.lifecycle,
        finalDisposition: persistedOpportunity.opportunity.disposition,
        safetyEnforced: true,
      });
    }
  } catch (error) {
    failure = safeError(error);
  }

  const operatingAfter = sha256File(operatingDatabasePath);
  const ids = new Set(leads.map((lead) => lead.opportunityId));
  const uids = new Set(leads.map((lead) => lead.publicUid));
  const assertions = {
    fiveUniqueOpportunities: leads.length === 5 && ids.size === 5 && uids.size === 5,
    transcriptsAndReconciliations: leads.length === 5 && leads.every((lead) => lead.transcriptId > 0 && lead.reconciliationId > 0),
    tasksAndActions: leads.length === 5 && leads.every((lead) => lead.researchTaskCount + lead.followUpTaskCount > 0 && lead.nextAction.length > 0),
    variedDispositions: new Set(leads.map((lead) => lead.finalDisposition).filter(Boolean)).size >= 3,
    noAutomaticPursuit: leads.length === 5 && leads.every((lead) => lead.lifecycleBeforeOwnerDecision === 'lead'),
    safetyEnforced: leads.length === 5 && leads.every((lead) => lead.safetyEnforced),
  };
  const unchanged = operatingBefore === operatingAfter;
  if (!unchanged && !failure) failure = 'operating LandOS database SHA-256 changed during isolated QA simulation';
  if (Object.values(assertions).some((value) => !value) && !failure) failure = 'one or more Phase 1 five-lead assertions failed';
  const finished = now();
  const report: FiveLeadSimulationReport = {
    schemaVersion: 1, runId, startedAt: started.toISOString(), finishedAt: finished.toISOString(),
    outcome: failure ? 'fail' : 'pass', baseUrl, storageProfile: liveProfile,
    redaction: { rawLeadDataIncluded: false, rawTranscriptsIncluded: false, tokenIncluded: false },
    operatingDatabase: { sha256Before: operatingBefore, sha256After: operatingAfter, unchanged },
    assertions, leads, ...(failure ? { error: failure } : {}),
  };
  const runRoot = path.join(reportRoot, runId);
  fs.mkdirSync(runRoot, { recursive: true });
  report.reportJsonPath = path.join(runRoot, 'report.json');
  report.reportMarkdownPath = path.join(runRoot, 'report.md');
  fs.writeFileSync(report.reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.writeFileSync(report.reportMarkdownPath, markdown(report), { encoding: 'utf8', mode: 0o600 });
  return report;
}
