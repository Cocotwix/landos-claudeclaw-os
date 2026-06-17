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
import {
  CARD_VERIFICATION_STATUSES,
  KANBAN_STATUSES,
  LEAD_JOB_STATUSES,
  type CardVerificationStatus,
  type KanbanStatus,
  type LandosEntity,
  type LeadJobStatus,
} from './db.js';
import {
  upsertCardFromDukeRun,
  getPropertyCard,
  listPropertyCards,
  setCardKanbanStatus,
  setCardVerificationStatus,
  attachCardSourceEvidence,
  attachCardActivity,
  addCardNextAction,
  attachNearbySearchReference,
  createLeadJobs,
  listLeadJobs,
  updateLeadJob,
} from './property-card.js';
import { routeDukeRequest } from './duke-router.js';
import { planLandosIntake } from './intake-planner.js';
import { departmentRegistrySummary } from './department-registry.js';
import { INTAKE_TRANSPORTS, type IntakeTransport, type LandOSIntake, type ResponseMode } from './intake-types.js';
import { evaluateFact, evaluateComp, evaluateZoning } from './source-evidence.js';
import { listDealCards, getDealCard, ensureDealCardForProperty, getDealCardIdForPropertyCard } from './deal-card.js';
import { addComp, listComps, recommendCompSources, evaluateCompRecency } from './comps.js';
import {
  DEAL_CARD_STATUSES,
  type DealCardStatus,
  type CompSourceLabel,
  type CompPriceKind,
  type CompStatus,
} from './db.js';

const isEntity = (v: unknown): v is LandosEntity =>
  v === 'LAND_ALLY' || v === 'TY_LAND_BIZ';
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

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

  // ── Property Card / Property Memory ─────────────────────────────────
  // The property-centered source of truth. Every Duke property-address run
  // creates or updates a card. Identity is never inferred from coordinates.

  app.get('/api/landos/property-cards', (c) => {
    const entity = entityParam(c.req.query('entity'));
    const ks = c.req.query('kanbanStatus');
    const vs = c.req.query('verificationStatus');
    return c.json({
      cards: listPropertyCards({
        entity,
        kanbanStatus: (KANBAN_STATUSES as readonly string[]).includes(ks ?? '') ? (ks as KanbanStatus) : undefined,
        verificationStatus: (CARD_VERIFICATION_STATUSES as readonly string[]).includes(vs ?? '') ? (vs as CardVerificationStatus) : undefined,
      }),
    });
  });

  // Kanban board: cards grouped by status column (property-centered).
  app.get('/api/landos/board', (c) => {
    const entity = entityParam(c.req.query('entity'));
    const cards = listPropertyCards({ entity, limit: 500 });
    const columns: Record<string, unknown[]> = {};
    for (const s of KANBAN_STATUSES) columns[s] = [];
    for (const card of cards) columns[(card as { kanban_status: string }).kanban_status]?.push(card);
    return c.json({ columns, statuses: KANBAN_STATUSES });
  });

  app.get('/api/landos/property-cards/:id', (c) => {
    const card = getPropertyCard(Number(c.req.param('id')));
    if (!card) return c.json({ error: 'not found' }, 404);
    return c.json({ card });
  });

  // Create/update a card from a Duke property-address run. Body carries the
  // identity + verification the agent established. No live LP call here.
  app.post('/api/landos/property-cards', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const entity = body.entity;
    if (!isEntity(entity)) return c.json({ error: 'entity must be LAND_ALLY or TY_LAND_BIZ' }, 400);
    const activeInputAddress = str(body.activeInputAddress);
    if (!activeInputAddress || !activeInputAddress.trim()) {
      return c.json({ error: 'activeInputAddress required' }, 400);
    }
    try {
      const result = upsertCardFromDukeRun({
        entity,
        agentId: str(body.agentId),
        activeInputAddress,
        city: str(body.city),
        county: str(body.county),
        state: str(body.state),
        apn: str(body.apn),
        lpPropertyId: str(body.lpPropertyId),
        fips: str(body.fips),
        lpUrl: str(body.lpUrl),
        owner: str(body.owner),
        acres: num(body.acres),
        verified: body.verified === true,
        verificationSource: str(body.verificationSource),
        summary: str(body.summary),
        priorInputAddress: str(body.priorInputAddress),
        cardId: num(body.cardId),
      });
      return c.json({ card: result.card, created: result.created, warnings: result.warnings }, result.created ? 201 : 200);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'upsert failed' }, 400);
    }
  });

  // PATCH handles WORKFLOW changes only. It can move the kanban status freely,
  // and it can reject/archive a card (with a reason, audited). It can NEVER
  // directly promote a card to verified_property — that requires strong parcel
  // identity evidence through POST /property-cards — and it never downgrades a
  // verified card to a non-terminal status or erases identity evidence.
  app.patch('/api/landos/property-cards/:id', async (c) => {
    const id = Number(c.req.param('id'));
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    let updated;
    if (body.kanbanStatus !== undefined) {
      if (!(KANBAN_STATUSES as readonly string[]).includes(String(body.kanbanStatus))) {
        return c.json({ error: 'invalid kanbanStatus' }, 400);
      }
      updated = setCardKanbanStatus(id, body.kanbanStatus as KanbanStatus);
      if (!updated) return c.json({ error: 'not found' }, 404);
    }
    if (body.verificationStatus !== undefined) {
      const vs = String(body.verificationStatus);
      if (vs === 'verified_property' || vs === 'unverified_lead' || vs === 'address_matched') {
        return c.json({
          error: 'verification_status cannot be promoted or downgraded via PATCH. Provide strong parcel identity evidence (APN + county/state/FIPS, or LandPortal property id + FIPS) via POST /api/landos/property-cards.',
        }, 400);
      }
      // Only rejected_mismatch / archived are allowed here, with a reason.
      const result = setCardVerificationStatus(id, vs as CardVerificationStatus, str(body.actor) ?? 'tyler', str(body.reason) ?? '');
      if (result.error) {
        return c.json({ error: result.error }, result.error === 'not found' ? 404 : 400);
      }
      updated = result.card;
    }
    if (!updated) return c.json({ error: 'no valid field (use kanbanStatus, or verificationStatus=rejected_mismatch|archived with a reason)' }, 400);
    return c.json({ card: updated });
  });

  // Attach a Nearby Search Reference (verified subject parcel only). Never
  // identity/offer-usable; never the subject parcel address.
  app.post('/api/landos/property-cards/:id/nearby-reference', async (c) => {
    const id = Number(c.req.param('id'));
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    if (!str(body.address)) return c.json({ error: 'address required' }, 400);
    const result = attachNearbySearchReference({
      cardId: id,
      address: str(body.address)!,
      relationship: str(body.relationship) as never,
      sourceLink: str(body.sourceLink),
      note: str(body.note),
      dateAccessed: str(body.dateAccessed),
    });
    if (result.error) {
      return c.json({ error: result.error, label: result.label }, result.error === 'card not found' ? 404 : 400);
    }
    return c.json(result, 201);
  });

  app.post('/api/landos/property-cards/:id/source-evidence', async (c) => {
    const id = Number(c.req.param('id'));
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    if (!str(body.fact)) return c.json({ error: 'fact required' }, 400);
    const res = attachCardSourceEvidence({
      cardId: id,
      fact: str(body.fact)!,
      value: str(body.value),
      sourceUrl: str(body.sourceUrl),
      sourceLabel: str(body.sourceLabel),
      dateAccessed: str(body.dateAccessed),
      note: str(body.note),
      parcelVerified: body.parcelVerified === true,
    });
    return c.json(res, 201);
  });

  app.post('/api/landos/property-cards/:id/activity', async (c) => {
    const id = Number(c.req.param('id'));
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const evId = attachCardActivity({
      cardId: id,
      agentId: str(body.agentId) ?? 'tyler',
      kind: str(body.kind) ?? 'note',
      summary: str(body.summary) ?? '',
      ref: str(body.ref),
    });
    return c.json({ id: evId }, 201);
  });

  app.post('/api/landos/property-cards/:id/next-action', async (c) => {
    const id = Number(c.req.param('id'));
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    if (!str(body.action)) return c.json({ error: 'action required' }, 400);
    const naId = addCardNextAction({ cardId: id, action: str(body.action)!, createdBy: str(body.createdBy) });
    return c.json({ id: naId }, 201);
  });

  // ── Batch lead intake ───────────────────────────────────────────────
  app.post('/api/landos/lead-jobs', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const entity = body.entity;
    if (!isEntity(entity)) return c.json({ error: 'entity must be LAND_ALLY or TY_LAND_BIZ' }, 400);
    const text = str(body.text);
    if (!text || !text.trim()) return c.json({ error: 'text required' }, 400);
    const { batchId, jobs } = createLeadJobs({ entity, text, agentId: str(body.agentId) });
    return c.json({ batchId, jobs, count: jobs.length }, 201);
  });

  app.get('/api/landos/lead-jobs', (c) => {
    const entity = entityParam(c.req.query('entity'));
    const status = c.req.query('status');
    const batchId = c.req.query('batchId') || undefined;
    return c.json({
      jobs: listLeadJobs({
        entity,
        batchId,
        status: (LEAD_JOB_STATUSES as readonly string[]).includes(status ?? '') ? (status as LeadJobStatus) : undefined,
      }),
    });
  });

  app.patch('/api/landos/lead-jobs/:id', async (c) => {
    const id = Number(c.req.param('id'));
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    if (body.status !== undefined && !(LEAD_JOB_STATUSES as readonly string[]).includes(String(body.status))) {
      return c.json({ error: 'invalid status' }, 400);
    }
    const updated = updateLeadJob(id, {
      status: body.status as LeadJobStatus | undefined,
      cardId: num(body.cardId),
      resultSummary: str(body.resultSummary),
      nextAction: str(body.nextAction),
      error: str(body.error),
    });
    if (!updated) return c.json({ error: 'not found' }, 404);
    return c.json({ job: updated });
  });

  // ── Deal Cards (the user-facing object) ─────────────────────────────
  app.get('/api/landos/deal-cards', (c) => {
    const entity = entityParam(c.req.query('entity'));
    const status = c.req.query('status');
    return c.json({
      dealCards: listDealCards({
        entity,
        status: (DEAL_CARD_STATUSES as readonly string[]).includes(status ?? '') ? (status as DealCardStatus) : undefined,
      }),
    });
  });

  app.get('/api/landos/deal-cards/:id', (c) => {
    const deal = getDealCard(Number(c.req.param('id')));
    if (!deal) return c.json({ error: 'not found' }, 404);
    return c.json({ dealCard: deal });
  });

  // ── Comps (manual + automated). Never verifies parcel identity. ─────
  app.get('/api/landos/deal-cards/:id/comps', (c) => {
    return c.json({ comps: listComps({ dealCardId: Number(c.req.param('id')) }) });
  });

  app.post('/api/landos/deal-cards/:id/comps', async (c) => {
    const dealCardId = Number(c.req.param('id'));
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const deal = getDealCard(dealCardId);
    if (!deal) return c.json({ error: 'deal card not found' }, 404);
    if (!isEntity(deal.entity)) return c.json({ error: 'deal card has no valid entity' }, 400);
    const comp = addComp({
      entity: deal.entity,
      dealCardId,
      cardId: num(body.cardId),
      sourceLabel: str(body.sourceLabel) as CompSourceLabel | undefined,
      sourceUrl: str(body.sourceUrl),
      addressDesc: str(body.addressDesc),
      apn: str(body.apn),
      county: str(body.county),
      state: str(body.state),
      price: num(body.price),
      priceKind: str(body.priceKind) as CompPriceKind | undefined,
      saleOrListDate: str(body.saleOrListDate),
      acres: num(body.acres),
      pricePerAcre: num(body.pricePerAcre),
      notes: str(body.notes),
      addedBy: str(body.addedBy),
      status: str(body.status) as CompStatus | undefined,
    });
    return c.json({ comp }, 201);
  });

  // Property-card-scoped comps for the Property Board UI. A property card may
  // not have a Deal Card yet; GET resolves the linked deal (if any) and POST
  // find-or-creates it. A comp NEVER changes the property's verification status,
  // identity, owner, contiguity, or facts.
  app.get('/api/landos/property-cards/:id/comps', (c) => {
    const cardId = Number(c.req.param('id'));
    const dealCardId = getDealCardIdForPropertyCard(cardId) ?? null;
    return c.json({ dealCardId, comps: listComps({ cardId }) });
  });

  app.post('/api/landos/property-cards/:id/comps', async (c) => {
    const cardId = Number(c.req.param('id'));
    const card = getPropertyCard(cardId);
    if (!card) return c.json({ error: 'property card not found' }, 404);
    if (!isEntity(card.entity)) return c.json({ error: 'property card has no valid entity' }, 400);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const dealCardId = ensureDealCardForProperty({ cardId, entity: card.entity, title: card.active_input_address });
    const comp = addComp({
      entity: card.entity,
      dealCardId,
      cardId,
      sourceLabel: str(body.sourceLabel) as CompSourceLabel | undefined,
      sourceUrl: str(body.sourceUrl),
      addressDesc: str(body.addressDesc),
      apn: str(body.apn),
      county: str(body.county),
      state: str(body.state),
      price: num(body.price),
      priceKind: str(body.priceKind) as CompPriceKind | undefined,
      saleOrListDate: str(body.saleOrListDate),
      acres: num(body.acres),
      pricePerAcre: num(body.pricePerAcre),
      notes: str(body.notes),
      addedBy: str(body.addedBy),
      status: str(body.status) as CompStatus | undefined,
    });
    return c.json({ comp, dealCardId }, 201);
  });

  // Comp-source recommendation + LP staleness (no paid calls; advice only).
  app.post('/api/landos/comps/recommend', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const recommendation = recommendCompSources({
      acres: num(body.acres),
      lpAvailable: body.lpAvailable === true,
      lpStale: body.lpStale === true,
      niche: body.niche === true,
    });
    const recency = str(body.newestCompDate) || str(body.runDate)
      ? evaluateCompRecency(str(body.newestCompDate) ?? null, str(body.runDate) ?? new Date().toISOString())
      : undefined;
    return c.json({ recommendation, recency });
  });

  // ── Duke capability router (classification only) ────────────────────
  app.post('/api/landos/duke/route', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const text = str(body.text) ?? '';
    return c.json({ result: routeDukeRequest(text) });
  });

  // ── LandOS Intake / Main Orchestrator (READ-ONLY planner) ───────────
  // The single entry path for dashboard text/voice, Telegram text/voice, CRM
  // leads, and manual API. Returns a worker dispatch plan only: it runs no
  // agent, writes no DB row, calls no LandPortal/comp tool, and never fakes
  // market data. Duke/Due Diligence stays operational through this path.
  app.post('/api/landos/intake', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const text = str(body.text);
    if (!text || !text.trim()) return c.json({ error: 'text required' }, 400);
    const transport = (INTAKE_TRANSPORTS as readonly string[]).includes(str(body.transport) ?? '')
      ? (str(body.transport) as IntakeTransport)
      : 'manual_api';
    const requestedResponseMode = ['text_only', 'text_and_voice_summary', 'voice_briefing_requested'].includes(str(body.responseMode) ?? '')
      ? (str(body.responseMode) as ResponseMode)
      : undefined;
    const ctxRaw = body.context as Record<string, unknown> | undefined;
    const intake: LandOSIntake = {
      transport,
      text,
      voiceTranscriptSource: str(body.voiceTranscriptSource) as LandOSIntake['voiceTranscriptSource'],
      requestedResponseMode,
      entityHint: str(body.entityHint),
      context: ctxRaw
        ? {
            parcelVerified: ctxRaw.parcelVerified === true,
            verifiedFacts: Array.isArray(ctxRaw.verifiedFacts)
              ? (ctxRaw.verifiedFacts as Array<Record<string, unknown>>)
                  .filter((f) => typeof f.fact === 'string' && typeof f.source === 'string')
                  .map((f) => ({ fact: String(f.fact), value: str(f.value), source: String(f.source) }))
              : undefined,
            propertyCardId: num(ctxRaw.propertyCardId),
            dealCardId: num(ctxRaw.dealCardId),
          }
        : undefined,
    };
    return c.json({ plan: planLandosIntake(intake) });
  });

  // Department registry summary (deeper capability/model-policy registry).
  app.get('/api/landos/department-registry', (c) => c.json({ departments: departmentRegistrySummary() }));

  // ── Source Evidence Standard check ──────────────────────────────────
  app.post('/api/landos/source-evidence/check', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const kind = str(body.kind) ?? 'fact';
    if (kind === 'comp') return c.json({ result: evaluateComp(body as never) });
    if (kind === 'zoning') return c.json({ result: evaluateZoning(body as never) });
    if (!str(body.fact)) return c.json({ error: 'fact required for kind=fact' }, 400);
    return c.json({ result: evaluateFact(body as never) });
  });

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
