// LandOS dashboard API routes — OS Spine v1.
//
// Mounted into the existing dashboard Hono app (src/dashboard.ts) behind the
// existing token auth middleware, before the SPA catch-all. Everything here
// is repo-safe metadata and counts: no secrets, no LP tokens, no paid calls.

import type { Hono } from 'hono';

import { DEPARTMENTS } from './departments.js';
import {
  GATED_ACTION_TYPES,
  LANDOS_ENTITIES,
  PLAYBOOK_STAGES,
  countRows,
  createApproval,
  decideApproval,
  getLandosDb,
  getOverview,
  landosAudit,
  listApprovals,
  listLandosAudit,
  listRows,
} from './db.js';
import { RUBRIC_FACTORS, RUBRIC_SOURCE, RUBRIC_STATUS, VERDICT_TIERS } from './rubric.js';
import { STRATEGIES, evaluateStrategies } from './offer-engine.js';

function entityParam(raw: string | undefined): string | undefined {
  if (!raw || raw === 'all') return undefined;
  return (LANDOS_ENTITIES as readonly string[]).includes(raw) ? raw : undefined;
}

export function registerLandosRoutes(app: Hono): void {
  app.get('/api/landos/overview', (c) => {
    const entity = entityParam(c.req.query('entity'));
    const overview = getOverview(entity);
    return c.json({
      ...overview,
      departments: DEPARTMENTS,
      pendingApprovalList: listApprovals('pending', 20),
    });
  });

  app.get('/api/landos/entities', (c) => {
    const rows = getLandosDb().prepare('SELECT * FROM landos_business_entity ORDER BY id').all();
    return c.json({ entities: rows });
  });

  app.get('/api/landos/departments', (c) => c.json({ departments: DEPARTMENTS }));

  // ── Record lists (entity filterable) ───────────────────────────────
  app.get('/api/landos/leads', (c) => {
    const entity = entityParam(c.req.query('entity'));
    return c.json({ leads: listRows('landos_lead', { entity }) });
  });

  app.get('/api/landos/deals', (c) => {
    const entity = entityParam(c.req.query('entity'));
    return c.json({ deals: listRows('landos_deal', { entity }) });
  });

  app.get('/api/landos/dd-queue', (c) => {
    const entity = entityParam(c.req.query('entity'));
    const db = getLandosDb();
    const parcelSql = entity
      ? 'SELECT * FROM landos_parcel WHERE verified = 0 AND entity = ? ORDER BY created_at DESC LIMIT 100'
      : 'SELECT * FROM landos_parcel WHERE verified = 0 ORDER BY created_at DESC LIMIT 100';
    const dealSql = entity
      ? `SELECT * FROM landos_deal WHERE status IN ('evaluating','due_diligence') AND entity = ? ORDER BY created_at DESC LIMIT 100`
      : `SELECT * FROM landos_deal WHERE status IN ('evaluating','due_diligence') ORDER BY created_at DESC LIMIT 100`;
    return c.json({
      unverifiedParcels: entity ? db.prepare(parcelSql).all(entity) : db.prepare(parcelSql).all(),
      ddDeals: entity ? db.prepare(dealSql).all(entity) : db.prepare(dealSql).all(),
    });
  });

  app.get('/api/landos/offer-queue', (c) => {
    const entity = entityParam(c.req.query('entity'));
    const db = getLandosDb();
    const dealSql = entity
      ? `SELECT * FROM landos_deal WHERE status IN ('offer_pending','offer_made') AND entity = ? ORDER BY created_at DESC LIMIT 100`
      : `SELECT * FROM landos_deal WHERE status IN ('offer_pending','offer_made') ORDER BY created_at DESC LIMIT 100`;
    const offerApprovals = db
      .prepare(`SELECT * FROM landos_approval WHERE action_type = 'offer_price' AND status = 'pending' ORDER BY created_at DESC LIMIT 100`)
      .all();
    return c.json({
      offerDeals: entity ? db.prepare(dealSql).all(entity) : db.prepare(dealSql).all(),
      pendingOfferApprovals: offerApprovals,
    });
  });

  // ── Approvals ───────────────────────────────────────────────────────
  app.get('/api/landos/approvals', (c) => {
    const status = c.req.query('status');
    return c.json({
      approvals: listApprovals(status && status !== 'all' ? status : undefined),
      gatedActionTypes: GATED_ACTION_TYPES,
    });
  });

  app.post('/api/landos/approvals', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const { actionType, title, payload, requestedBy, entity } = body as Record<string, unknown>;
    if (typeof actionType !== 'string' || typeof title !== 'string' || !actionType || !title) {
      return c.json({ error: 'actionType and title are required' }, 400);
    }
    const id = createApproval({
      actionType,
      title,
      payload,
      requestedBy: typeof requestedBy === 'string' ? requestedBy : 'dashboard',
      entity: entityParam(typeof entity === 'string' ? entity : undefined) as never,
    });
    return c.json({ id, status: 'pending' });
  });

  app.post('/api/landos/approvals/:id/approve', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'Invalid id' }, 400);
    const body = await c.req.json().catch(() => ({}));
    const row = decideApproval(id, 'approved', (body as Record<string, string>).decidedBy || 'tyler', (body as Record<string, string>).note || '');
    if (!row) return c.json({ error: 'Approval not found or not pending' }, 404);
    return c.json({ approval: row });
  });

  app.post('/api/landos/approvals/:id/reject', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'Invalid id' }, 400);
    const body = await c.req.json().catch(() => ({}));
    const row = decideApproval(id, 'rejected', (body as Record<string, string>).decidedBy || 'tyler', (body as Record<string, string>).note || '');
    if (!row) return c.json({ error: 'Approval not found or not pending' }, 404);
    return c.json({ approval: row });
  });

  // ── Rules & playbooks ───────────────────────────────────────────────
  app.get('/api/landos/rules', (c) => c.json({ rules: listRows('landos_rule') }));

  app.post('/api/landos/rules', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const { name, body: ruleBody, scope, entity, source } = body as Record<string, unknown>;
    if (typeof name !== 'string' || !name) return c.json({ error: 'name is required' }, 400);
    // New rules always enter as draft. Promotion to approved goes through
    // Tyler (raw training never auto-becomes approved behavior).
    const result = getLandosDb().prepare(
      `INSERT INTO landos_rule (entity, scope, name, body, status, source)
       VALUES (?, ?, ?, ?, 'draft', ?)`,
    ).run(
      entityParam(typeof entity === 'string' ? entity : undefined) ?? null,
      typeof scope === 'string' && ['global', 'entity', 'strategy', 'deal'].includes(scope) ? scope : 'global',
      name,
      typeof ruleBody === 'string' ? ruleBody : '',
      typeof source === 'string' ? source : '',
    );
    const id = result.lastInsertRowid as number;
    landosAudit('dashboard', 'rule_created_draft', name, { refTable: 'landos_rule', refId: id });
    return c.json({ id, status: 'draft' });
  });

  app.get('/api/landos/playbooks', (c) => c.json({
    playbooks: listRows('landos_playbook'),
    lifecycle: PLAYBOOK_STAGES,
  }));

  app.post('/api/landos/playbooks', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const { name, body: pbBody, stage, entity, sourceRef } = body as Record<string, unknown>;
    if (typeof name !== 'string' || !name) return c.json({ error: 'name is required' }, 400);
    const stageVal = typeof stage === 'string' && (PLAYBOOK_STAGES as readonly string[]).includes(stage)
      ? stage
      : 'raw_training';
    const result = getLandosDb().prepare(
      `INSERT INTO landos_playbook (entity, name, stage, body, source_ref) VALUES (?, ?, ?, ?, ?)`,
    ).run(
      entityParam(typeof entity === 'string' ? entity : undefined) ?? null,
      name,
      stageVal,
      typeof pbBody === 'string' ? pbBody : '',
      typeof sourceRef === 'string' ? sourceRef : '',
    );
    const id = result.lastInsertRowid as number;
    landosAudit('dashboard', 'playbook_created', `${name} (${stageVal})`, { refTable: 'landos_playbook', refId: id });
    return c.json({ id, stage: stageVal });
  });

  // ── Research & security ─────────────────────────────────────────────
  app.get('/api/landos/research', (c) => {
    const kind = c.req.query('kind');
    const db = getLandosDb();
    const rows = kind && ['market', 'industry', 'ai_change'].includes(kind)
      ? db.prepare('SELECT * FROM landos_research_item WHERE kind = ? ORDER BY created_at DESC LIMIT 200').all(kind)
      : listRows('landos_research_item', { limit: 200 });
    return c.json({ research: rows });
  });

  app.post('/api/landos/research', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const { kind, title, body: rBody, sourceUrl, entity } = body as Record<string, unknown>;
    if (typeof title !== 'string' || !title) return c.json({ error: 'title is required' }, 400);
    if (typeof kind !== 'string' || !['market', 'industry', 'ai_change'].includes(kind)) {
      return c.json({ error: 'kind must be market | industry | ai_change' }, 400);
    }
    const result = getLandosDb().prepare(
      `INSERT INTO landos_research_item (kind, entity, title, body, source_url) VALUES (?, ?, ?, ?, ?)`,
    ).run(
      kind,
      entityParam(typeof entity === 'string' ? entity : undefined) ?? null,
      title,
      typeof rBody === 'string' ? rBody : '',
      typeof sourceUrl === 'string' ? sourceUrl : '',
    );
    return c.json({ id: result.lastInsertRowid as number });
  });

  app.get('/api/landos/security-reviews', (c) => c.json({
    reviews: listRows('landos_security_review'),
  }));

  app.post('/api/landos/security-reviews', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const { subjectType, subject, verdict, notes, reviewer } = body as Record<string, unknown>;
    if (typeof subject !== 'string' || !subject) return c.json({ error: 'subject is required' }, 400);
    const result = getLandosDb().prepare(
      `INSERT INTO landos_security_review (subject_type, subject, verdict, notes, reviewer) VALUES (?, ?, ?, ?, ?)`,
    ).run(
      typeof subjectType === 'string' ? subjectType : '',
      subject,
      typeof verdict === 'string' ? verdict : 'pending',
      typeof notes === 'string' ? notes : '',
      typeof reviewer === 'string' ? reviewer : '',
    );
    const id = result.lastInsertRowid as number;
    landosAudit('dashboard', 'security_review_created', subject, { refTable: 'landos_security_review', refId: id });
    return c.json({ id });
  });

  // ── Costs & audit ───────────────────────────────────────────────────
  app.get('/api/landos/costs', (c) => {
    const db = getLandosDb();
    const modelCalls = listRows('landos_model_call', { limit: 100 });
    const costRecords = listRows('landos_cost_record', { limit: 100 });
    const modelTotal = db.prepare('SELECT COALESCE(SUM(est_cost_usd), 0) AS s, COUNT(*) AS n FROM landos_model_call').get() as { s: number; n: number };
    const costTotal = db.prepare('SELECT COALESCE(SUM(amount_usd), 0) AS s, COUNT(*) AS n FROM landos_cost_record').get() as { s: number; n: number };
    return c.json({
      modelCalls,
      costRecords,
      totals: {
        modelCalls: modelTotal.n,
        modelCostUsd: modelTotal.s,
        costRecords: costTotal.n,
        costRecordsUsd: costTotal.s,
      },
    });
  });

  app.get('/api/landos/audit', (c) => {
    const limit = Math.min(Number(c.req.query('limit')) || 100, 500);
    return c.json({ audit: listLandosAudit(limit), total: countRows('landos_audit_log') });
  });

  // ── Read-only config surfaces (rubric + offer strategies) ──────────
  app.get('/api/landos/rubric', (c) => c.json({
    source: RUBRIC_SOURCE,
    status: RUBRIC_STATUS,
    factors: RUBRIC_FACTORS,
    verdictTiers: VERDICT_TIERS,
  }));

  app.get('/api/landos/strategies', (c) => c.json({ strategies: STRATEGIES }));

  // Scenario preview: internal underwriting math only. Never seller-facing.
  app.post('/api/landos/strategies/evaluate', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const ev = Number((body as Record<string, unknown>).expectedValueUsd);
    if (!Number.isFinite(ev) || ev <= 0) {
      return c.json({ error: 'expectedValueUsd must be a positive number' }, 400);
    }
    const scenarios = evaluateStrategies({
      expectedValueUsd: ev,
      acres: Number((body as Record<string, unknown>).acres) || undefined,
      verifiedManufacturedSalesUsd: Array.isArray((body as Record<string, unknown>).verifiedManufacturedSalesUsd)
        ? ((body as Record<string, unknown>).verifiedManufacturedSalesUsd as number[]).filter((n) => Number.isFinite(n))
        : undefined,
      riskFactors: Array.isArray((body as Record<string, unknown>).riskFactors)
        ? ((body as Record<string, unknown>).riskFactors as string[])
        : undefined,
    });
    return c.json({ scenarios, note: 'Internal underwriting preview. DRAFT scenarios must never be presented as final offers.' });
  });
}
