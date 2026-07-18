import { beforeEach, describe, expect, it } from 'vitest';

import {
  _initTestLandosDb,
  createApproval,
  decideApproval,
  FACT_LABELS,
  gateAction,
  getApproval,
  getLandosDb,
  getOverview,
  listApprovals,
  listLandosAudit,
  listRows,
  logCostRecord,
  logModelCall,
  startAgentRun,
  finishAgentRun,
} from './db.js';
import {
  evaluateStrategies,
  GLOBAL_MIN_NET_PROFIT_USD,
  LAND_HOME_GATE,
  SUBDIVISION_MIN_NET_PROFIT_USD,
} from './offer-engine.js';
import { RUBRIC_FACTORS, RUBRIC_MAX_SCORE, scoreVerdict } from './rubric.js';

const EXPECTED_TABLES = [
  'landos_business_entity', 'landos_contact', 'landos_seller', 'landos_lead',
  'landos_property', 'landos_parcel', 'landos_deal', 'landos_fact',
  'landos_task', 'landos_file_ref', 'landos_note', 'landos_agent_run',
  'landos_approval', 'landos_audit_log', 'landos_rule', 'landos_playbook',
  'landos_model_call', 'landos_cost_record', 'landos_security_review',
  'landos_research_item',
];

beforeEach(() => {
  _initTestLandosDb();
});

describe('landos schema', () => {
  it('creates all OS spine tables', () => {
    const db = getLandosDb();
    const rows = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'landos_%'`)
      .all() as Array<{ name: string }>;
    const names = new Set(rows.map((r) => r.name));
    for (const t of EXPECTED_TABLES) {
      expect(names.has(t), `missing table ${t}`).toBe(true);
    }
  });

  it('seeds LAND_ALLY and TY_LAND_BIZ entities', () => {
    const rows = getLandosDb()
      .prepare('SELECT id FROM landos_business_entity ORDER BY id')
      .all() as Array<{ id: string }>;
    expect(rows.map((r) => r.id)).toEqual(['LAND_ALLY', 'TY_LAND_BIZ']);
  });

  it('rejects invalid fact labels and accepts all defined labels', () => {
    const db = getLandosDb();
    expect(() =>
      db.prepare(
        `INSERT INTO landos_fact (entity, fact, label) VALUES ('LAND_ALLY', 'zoning', 'Vibes')`,
      ).run(),
    ).toThrow();
    for (const label of FACT_LABELS) {
      db.prepare(
        `INSERT INTO landos_fact (entity, fact, label) VALUES ('LAND_ALLY', 'zoning', ?)`,
      ).run(label);
    }
    const n = db.prepare('SELECT COUNT(*) AS n FROM landos_fact').get() as { n: number };
    expect(n.n).toBe(FACT_LABELS.length);
  });

  it('rejects invalid rule status', () => {
    const db = getLandosDb();
    expect(() =>
      db.prepare(`INSERT INTO landos_rule (name, status) VALUES ('r1', 'live')`).run(),
    ).toThrow();
    db.prepare(`INSERT INTO landos_rule (name, status) VALUES ('r1', 'draft')`).run();
    db.prepare(`INSERT INTO landos_rule (name, status) VALUES ('r2', 'experimental')`).run();
  });

  it('rejects invalid playbook lifecycle stage', () => {
    const db = getLandosDb();
    expect(() =>
      db.prepare(`INSERT INTO landos_playbook (name, stage) VALUES ('p1', 'shipped')`).run(),
    ).toThrow();
    db.prepare(`INSERT INTO landos_playbook (name, stage) VALUES ('p1', 'raw_training')`).run();
  });
});

describe('entity separation', () => {
  it('filters business records strictly by entity', () => {
    const db = getLandosDb();
    db.prepare(`INSERT INTO landos_lead (entity, source) VALUES ('LAND_ALLY', 'web')`).run();
    db.prepare(`INSERT INTO landos_lead (entity, source) VALUES ('LAND_ALLY', 'mail')`).run();
    db.prepare(`INSERT INTO landos_lead (entity, source) VALUES ('TY_LAND_BIZ', 'web')`).run();

    const la = listRows('landos_lead', { entity: 'LAND_ALLY' }) as Array<{ entity: string }>;
    const ty = listRows('landos_lead', { entity: 'TY_LAND_BIZ' }) as Array<{ entity: string }>;
    expect(la).toHaveLength(2);
    expect(ty).toHaveLength(1);
    expect(la.every((r) => r.entity === 'LAND_ALLY')).toBe(true);
    expect(ty.every((r) => r.entity === 'TY_LAND_BIZ')).toBe(true);

    const overviewLa = getOverview('LAND_ALLY');
    const overviewTy = getOverview('TY_LAND_BIZ');
    expect(overviewLa.counts.lead).toBe(2);
    expect(overviewTy.counts.lead).toBe(1);
  });

  it('rejects records with an unknown entity', () => {
    const db = getLandosDb();
    db.pragma('foreign_keys = ON');
    expect(() =>
      db.prepare(`INSERT INTO landos_lead (entity) VALUES ('SOME_OTHER_BIZ')`).run(),
    ).toThrow();
  });
});

describe('approval gate', () => {
  it('hard-prohibits paid actions without creating an approval', () => {
    const result = gateAction({
      actionType: 'paid_credit',
      title: 'Use 1 LandPortal comp credit',
      requestedBy: 'duke-due-diligence',
    });
    expect(result.allowed).toBe(false);
    expect(result.status).toBe('prohibited');
    const approval = getApproval(result.approvalId);
    expect(approval).toBeUndefined();

    const audit = listLandosAudit() as Array<{ action: string; blocked: number }>;
    expect(audit.some((a) => a.action === 'prohibited_action_blocked' && a.blocked === 1)).toBe(true);
    expect(audit.some((a) => a.action === 'approval_requested')).toBe(false);
  });

  it('hard-prohibits seller messages even when an approval id is supplied', () => {
    const blocked = gateAction({
      actionType: 'seller_message',
      title: 'Send follow-up draft',
      requestedBy: 'acquisition-copilot',
    });
    expect(blocked.allowed).toBe(false);

    const allowed = gateAction({
      actionType: 'seller_message',
      title: 'Send follow-up draft',
      requestedBy: 'acquisition-copilot',
      approvalId: blocked.approvalId,
    });
    expect(allowed.allowed).toBe(false);
    expect(allowed.status).toBe('prohibited');

    // Single use: the same approval cannot authorize a second action.
    const replay = gateAction({
      actionType: 'seller_message',
      title: 'Send follow-up draft again',
      requestedBy: 'acquisition-copilot',
      approvalId: blocked.approvalId,
    });
    expect(replay.allowed).toBe(false);
  });

  it('blocks when the approval was rejected or has the wrong action type', () => {
    const a = createApproval({ actionType: 'offer_price', title: 'Offer $12k', requestedBy: 'main' });
    decideApproval(a, 'rejected', 'tyler', 'too high');
    expect(
      gateAction({ actionType: 'offer_price', title: 'Offer $12k', requestedBy: 'main', approvalId: a }).allowed,
    ).toBe(false);

    const b = createApproval({ actionType: 'data_export', title: 'Export CSV', requestedBy: 'main' });
    decideApproval(b, 'approved', 'tyler');
    expect(
      gateAction({ actionType: 'file_deletion', title: 'Delete file', requestedBy: 'main', approvalId: b }).allowed,
    ).toBe(false);
  });

  it('only decides pending approvals', () => {
    const a = createApproval({ actionType: 'crm_change', title: 'Update stage', requestedBy: 'main' });
    expect(decideApproval(a, 'approved', 'tyler')).toBeTruthy();
    expect(decideApproval(a, 'rejected', 'tyler')).toBeUndefined();
    expect(listApprovals('approved')).toHaveLength(1);
  });
});

describe('agent runs and cost foundation', () => {
  it('records agent runs with audit entries', () => {
    const id = startAgentRun('duke-due-diligence', 'partial_report', 'LAND_ALLY');
    finishAgentRun(id, 'success', '3 tool calls, 1m52s');
    const runs = listRows('landos_agent_run') as Array<{ status: string; summary: string }>;
    expect(runs[0].status).toBe('success');
    const audit = listLandosAudit() as Array<{ action: string }>;
    expect(audit.some((a) => a.action === 'agent_run_started')).toBe(true);
    expect(audit.some((a) => a.action === 'agent_run_finished')).toBe(true);
  });

  it('logs model calls and cost records', () => {
    logModelCall({ agentId: 'main', provider: 'anthropic', model: 'claude-sonnet-4-6', taskClass: 'dd-synthesis', estCostUsd: 0.02 });
    logCostRecord({ category: 'data', description: 'test record', amountUsd: 1.5 });
    const overview = getOverview();
    expect(overview.counts.model_call).toBe(1);
    expect(overview.counts.cost_record).toBe(1);
    expect(overview.modelCostUsd).toBeCloseTo(0.02);
    expect(overview.costRecordsUsd).toBeCloseTo(1.5);
  });
});

describe('offer engine', () => {
  it('encodes the confirmed minimums', () => {
    expect(GLOBAL_MIN_NET_PROFIT_USD).toBe(10_000);
    expect(SUBDIVISION_MIN_NET_PROFIT_USD).toBe(30_000);
    expect(LAND_HOME_GATE.minVerifiedSaleUsd).toBe(200_000);
    expect(LAND_HOME_GATE.maxVerifiedSaleUsd).toBe(300_000);
  });

  it('produces confirmed quick flip band at 40-60% of EV', () => {
    const scenarios = evaluateStrategies({ expectedValueUsd: 100_000 });
    const flip = scenarios.find((s) => s.strategy === 'quick_flip')!;
    expect(flip.offerLowUsd).toBe(40_000);
    expect(flip.offerHighUsd).toBe(60_000);
    expect(flip.outputLabel).toBe('CONFIRMED PARAMETERS');
  });

  it('produces confirmed subdivision band at 55-65% of EV with $30k minimum', () => {
    const scenarios = evaluateStrategies({ expectedValueUsd: 200_000 });
    const sub = scenarios.find((s) => s.strategy === 'subdivision_minor_split')!;
    expect(sub.offerLowUsd).toBe(110_000);
    expect(sub.offerHighUsd).toBe(130_000);
    expect(sub.minNetProfitUsd).toBe(30_000);
    expect(sub.outputLabel).toBe('CONFIRMED PARAMETERS');
  });

  it('flags land-home package not feasible without verified sales in the gate range', () => {
    const noSales = evaluateStrategies({ expectedValueUsd: 100_000 });
    const lh1 = noSales.find((s) => s.strategy === 'land_home_package')!;
    expect(lh1.feasible).toBe(false);

    const lowSales = evaluateStrategies({
      expectedValueUsd: 100_000,
      verifiedManufacturedSalesUsd: [120_000, 150_000],
    });
    expect(lowSales.find((s) => s.strategy === 'land_home_package')!.feasible).toBe(false);

    const goodSales = evaluateStrategies({
      expectedValueUsd: 100_000,
      verifiedManufacturedSalesUsd: [240_000],
    });
    expect(goodSales.find((s) => s.strategy === 'land_home_package')!.feasible).toBe(true);
  });

  it('labels unconfirmed strategies as DRAFT', () => {
    const scenarios = evaluateStrategies({ expectedValueUsd: 100_000 });
    const wholesale = scenarios.find((s) => s.strategy === 'wholesale_assignment')!;
    expect(wholesale.outputLabel).toBe('DRAFT (UNCONFIRMED PARAMETERS)');
    expect(wholesale.reasons.join(' ')).toMatch(/UNCONFIRMED/);
  });

  it('marks risk-adjusted confirmed bands as DRAFT (draft scaling parameter)', () => {
    const scenarios = evaluateStrategies({
      expectedValueUsd: 100_000,
      riskFactors: ['hold_time', 'title_uncertainty'],
    });
    const flip = scenarios.find((s) => s.strategy === 'quick_flip')!;
    expect(flip.offerHighUsd).toBe(56_000); // 60% - 2 factors * 2pp
    expect(flip.outputLabel).toBe('DRAFT (UNCONFIRMED PARAMETERS)');
  });
});

describe('rubric', () => {
  it('factors sum to 100', () => {
    const total = RUBRIC_FACTORS.reduce((sum, f) => sum + f.maxPoints, 0);
    expect(total).toBe(RUBRIC_MAX_SCORE);
  });

  it('maps scores to verdict tiers', () => {
    expect(scoreVerdict(80)).toBe('PURSUE');
    expect(scoreVerdict(60)).toBe('PURSUE WITH CAUTION');
    expect(scoreVerdict(30)).toBe('PASS');
  });

  it('applies the tier-downgrade override at 2+ lowest-tier factors', () => {
    expect(scoreVerdict(78, 2)).toBe('PURSUE WITH CAUTION');
    expect(scoreVerdict(60, 2)).toBe('PASS');
    expect(scoreVerdict(78, 1)).toBe('PURSUE');
  });
});
