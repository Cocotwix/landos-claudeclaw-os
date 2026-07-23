import { randomUUID } from 'node:crypto';

import { getLandosDb, type LandosEntity } from './db.js';
import { getLandosStorageProfile } from './storage-profile.js';

export const OPPORTUNITY_LIFECYCLES = ['lead', 'deal', 'disposed'] as const;
export type OpportunityLifecycle = (typeof OPPORTUNITY_LIFECYCLES)[number];

export const OPPORTUNITY_RESEARCH_STATUSES = [
  'not_started', 'queued', 'running', 'partial', 'complete', 'failed',
] as const;
export type OpportunityResearchStatus = (typeof OPPORTUNITY_RESEARCH_STATUSES)[number];

export const OPPORTUNITY_DISCOVERY_STATUSES = [
  'not_started', 'brief_ready', 'call_complete', 'reconciled',
] as const;
export type OpportunityDiscoveryStatus = (typeof OPPORTUNITY_DISCOVERY_STATUSES)[number];

export const OPPORTUNITY_PIPELINE_STAGES = [
  'new_lead', 'researching', 'discovery_ready', 'discovery_complete',
  'pursuing', 'follow_up', 'under_contract', 'closed',
] as const;
export type OpportunityPipelineStage = (typeof OPPORTUNITY_PIPELINE_STAGES)[number];

interface OpportunityDbRow {
  id: number;
  public_uid: string;
  entity: LandosEntity;
  title: string;
  source: string;
  raw_input: string;
  lifecycle: OpportunityLifecycle;
  disposition: string | null;
  pursued_at: number | null;
  pursued_by: string | null;
  research_status: OpportunityResearchStatus;
  discovery_status: OpportunityDiscoveryStatus;
  pipeline_stage: OpportunityPipelineStage;
  legacy_deal_card_id: number | null;
  primary_property_card_id: number | null;
  legacy_status: string;
  created_at: number;
  updated_at: number;
}

export interface OpportunityRecord {
  id: number;
  publicUid: string;
  entity: LandosEntity;
  title: string;
  source: string;
  rawInput: string;
  lifecycle: OpportunityLifecycle;
  disposition: string | null;
  pursuedAt: number | null;
  pursuedBy: string | null;
  researchStatus: OpportunityResearchStatus;
  discoveryStatus: OpportunityDiscoveryStatus;
  pipelineStage: OpportunityPipelineStage;
  legacyDealCardId: number | null;
  primaryPropertyCardId: number | null;
  legacyStatus: string;
  createdAt: number;
  updatedAt: number;
}

export interface OpportunityLegacyAlias {
  type: 'deal_card' | 'property_card';
  legacyId: number;
}

export interface OpportunityHistoryEvent {
  id: number;
  eventType: string;
  fromLifecycle: OpportunityLifecycle | null;
  toLifecycle: OpportunityLifecycle | null;
  decision: string | null;
  actor: string;
  note: string;
  occurredAt: number;
}

export interface OpportunityDetail extends OpportunityRecord {
  aliases: OpportunityLegacyAlias[];
  history: OpportunityHistoryEvent[];
}

function mapRow(row: OpportunityDbRow): OpportunityRecord {
  return {
    id: row.id,
    publicUid: row.public_uid,
    entity: row.entity,
    title: row.title,
    source: row.source,
    rawInput: row.raw_input,
    lifecycle: row.lifecycle,
    disposition: row.disposition,
    pursuedAt: row.pursued_at,
    pursuedBy: row.pursued_by,
    researchStatus: row.research_status,
    discoveryStatus: row.discovery_status,
    pipelineStage: row.pipeline_stage,
    legacyDealCardId: row.legacy_deal_card_id,
    primaryPropertyCardId: row.primary_property_card_id,
    legacyStatus: row.legacy_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function publicUid(): string {
  return `opp_${randomUUID()}`;
}

function assertNonEmpty(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function assertOwner(owner: string): string {
  const normalized = assertNonEmpty(owner, 'owner');
  if (!['owner', 'tyler'].includes(normalized.toLowerCase())) {
    throw new Error('only the owner may pursue or dispose an opportunity');
  }
  return normalized;
}

function insertHistory(input: {
  opportunityId: number;
  eventType: string;
  fromLifecycle?: OpportunityLifecycle | null;
  toLifecycle?: OpportunityLifecycle | null;
  decision?: string | null;
  actor: string;
  note?: string;
  occurredAt?: number;
}): void {
  getLandosDb().prepare(`
    INSERT INTO landos_opportunity_history (
      opportunity_id, event_key, event_type, from_lifecycle, to_lifecycle,
      decision, actor, note, occurred_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.opportunityId,
    randomUUID(),
    input.eventType,
    input.fromLifecycle ?? null,
    input.toLifecycle ?? null,
    input.decision ?? null,
    input.actor,
    input.note ?? '',
    input.occurredAt ?? nowSeconds(),
  );
}

/** Ensure one opportunity exists for an existing legacy Deal Card. The legacy
 * graph is read and aliased only; no legacy row or accepted fact is updated. */
export function ensureOpportunityForLegacyDealCard(dealCardId: number): OpportunityRecord {
  if (!Number.isInteger(dealCardId) || dealCardId < 1) throw new Error('valid legacy Deal Card ID required');
  const db = getLandosDb();
  const execute = db.transaction(() => {
    const existing = db.prepare(`
      SELECT o.* FROM landos_opportunity o
      JOIN landos_opportunity_legacy_alias a ON a.opportunity_id = o.id
      WHERE a.alias_type = 'deal_card' AND a.legacy_id = ?
    `).get(dealCardId) as OpportunityDbRow | undefined;
    if (existing) return mapRow(existing);

    const legacy = db.prepare('SELECT * FROM landos_deal_card WHERE id = ?').get(dealCardId) as {
      id: number; entity: LandosEntity; title: string; status: string; lead_type: string;
      created_at: number; updated_at: number;
    } | undefined;
    if (!legacy) throw new Error(`legacy Deal Card ${dealCardId} not found`);
    const primary = db.prepare(`
      SELECT card_id FROM landos_deal_card_property
      WHERE deal_card_id = ?
      ORDER BY CASE WHEN role = 'subject' THEN 0 ELSE 1 END, id
      LIMIT 1
    `).get(dealCardId) as { card_id: number } | undefined;
    const result = db.prepare(`
      INSERT INTO landos_opportunity (
        public_uid, entity, title, source, lifecycle, legacy_deal_card_id,
        primary_property_card_id, legacy_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'lead', ?, ?, ?, ?, ?)
    `).run(
      publicUid(), legacy.entity, legacy.title,
      legacy.lead_type === 'manual' ? 'manual' : 'legacy_deal_card', legacy.id,
      primary?.card_id ?? null, legacy.status, legacy.created_at, legacy.updated_at,
    );
    const opportunityId = Number(result.lastInsertRowid);
    db.prepare(`
      INSERT INTO landos_opportunity_legacy_alias
        (opportunity_id, alias_type, legacy_id, created_at)
      VALUES (?, 'deal_card', ?, ?)
    `).run(opportunityId, legacy.id, legacy.created_at);
    db.prepare(`
      INSERT OR IGNORE INTO landos_opportunity_legacy_alias
        (opportunity_id, alias_type, legacy_id, created_at)
      SELECT ?, 'property_card', card_id, created_at
      FROM landos_deal_card_property WHERE deal_card_id = ?
    `).run(opportunityId, legacy.id);
    insertHistory({
      opportunityId,
      eventType: 'backfilled',
      toLifecycle: 'lead',
      actor: 'phase1-migration',
      note: 'Legacy Deal Card preserved as an alias; no pursuit or disposition inferred.',
      occurredAt: legacy.created_at,
    });
    return mapRow(db.prepare('SELECT * FROM landos_opportunity WHERE id = ?').get(opportunityId) as OpportunityDbRow);
  });
  return execute();
}

export interface OpportunityBackfillResult {
  legacyDealCards: number;
  opportunitiesBefore: number;
  opportunitiesAfter: number;
  created: number;
}

/** Idempotently reconcile every legacy Deal Card into exactly one opportunity. */
export function backfillLegacyOpportunities(): OpportunityBackfillResult {
  const db = getLandosDb();
  const ids = db.prepare('SELECT id FROM landos_deal_card ORDER BY id').all() as Array<{ id: number }>;
  const before = (db.prepare('SELECT COUNT(*) AS n FROM landos_opportunity').get() as { n: number }).n;
  for (const { id } of ids) ensureOpportunityForLegacyDealCard(id);
  const after = (db.prepare('SELECT COUNT(*) AS n FROM landos_opportunity').get() as { n: number }).n;
  return { legacyDealCards: ids.length, opportunitiesBefore: before, opportunitiesAfter: after, created: after - before };
}

export function createOpportunity(input: {
  entity: LandosEntity;
  title: string;
  source?: string;
  rawInput?: string;
  actor?: string;
}): OpportunityRecord {
  const db = getLandosDb();
  const now = nowSeconds();
  const result = db.prepare(`
    INSERT INTO landos_opportunity (
      public_uid, entity, title, source, raw_input, lifecycle, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'lead', ?, ?)
  `).run(
    publicUid(), input.entity, assertNonEmpty(input.title, 'title'),
    assertNonEmpty(input.source ?? 'manual', 'source'), input.rawInput ?? '', now, now,
  );
  const id = Number(result.lastInsertRowid);
  insertHistory({ opportunityId: id, eventType: 'created', toLifecycle: 'lead', actor: input.actor ?? 'operator', occurredAt: now });
  return getOpportunity(id)!;
}

export function getOpportunity(id: number): OpportunityRecord | undefined {
  const row = getLandosDb().prepare('SELECT * FROM landos_opportunity WHERE id = ?').get(id) as OpportunityDbRow | undefined;
  return row ? mapRow(row) : undefined;
}

export function getOpportunityByPublicUid(uid: string): OpportunityRecord | undefined {
  const row = getLandosDb().prepare('SELECT * FROM landos_opportunity WHERE public_uid = ?').get(uid) as OpportunityDbRow | undefined;
  return row ? mapRow(row) : undefined;
}

export function getOpportunityForLegacyDealCard(dealCardId: number): OpportunityRecord {
  return ensureOpportunityForLegacyDealCard(dealCardId);
}

/** Explicit route-facing alias: current Lead Workspace URLs carry Deal Card IDs. */
export function getOpportunityByDealCardId(dealCardId: number): OpportunityRecord {
  return ensureOpportunityForLegacyDealCard(dealCardId);
}

export function listOpportunityHistory(opportunityId: number): OpportunityHistoryEvent[] {
  const rows = getLandosDb().prepare(`
    SELECT id, event_type, from_lifecycle, to_lifecycle, decision, actor, note, occurred_at
    FROM landos_opportunity_history WHERE opportunity_id = ?
    ORDER BY occurred_at ASC, id ASC
  `).all(opportunityId) as Array<{
    id: number; event_type: string; from_lifecycle: OpportunityLifecycle | null;
    to_lifecycle: OpportunityLifecycle | null; decision: string | null; actor: string;
    note: string; occurred_at: number;
  }>;
  return rows.map((row) => ({
    id: row.id,
    eventType: row.event_type,
    fromLifecycle: row.from_lifecycle,
    toLifecycle: row.to_lifecycle,
    decision: row.decision,
    actor: row.actor,
    note: row.note,
    occurredAt: row.occurred_at,
  }));
}

export function getOpportunityDetail(id: number): OpportunityDetail | undefined {
  const opportunity = getOpportunity(id);
  if (!opportunity) return undefined;
  const aliases = getLandosDb().prepare(`
    SELECT alias_type, legacy_id FROM landos_opportunity_legacy_alias
    WHERE opportunity_id = ? ORDER BY alias_type, legacy_id
  `).all(id) as Array<{ alias_type: OpportunityLegacyAlias['type']; legacy_id: number }>;
  return {
    ...opportunity,
    aliases: aliases.map((row) => ({ type: row.alias_type, legacyId: row.legacy_id })),
    history: listOpportunityHistory(id),
  };
}

export function listOpportunities(options: {
  entity?: LandosEntity;
  lifecycle?: OpportunityLifecycle;
  limit?: number;
} = {}): OpportunityRecord[] {
  backfillLegacyOpportunities();
  const where: string[] = [];
  const args: Array<string | number> = [];
  if (options.entity) { where.push('entity = ?'); args.push(options.entity); }
  if (options.lifecycle) { where.push('lifecycle = ?'); args.push(options.lifecycle); }
  // Test leads can coexist in legacy storage while an operator migrates to the
  // isolated QA profile. They must never inflate operating counts or appear in
  // owner-facing operating drilldowns. QA mode remains the one place synthetic
  // TEST LEAD records are intentionally visible.
  const operatingFilter = getLandosStorageProfile().syntheticOnly
    ? ''
    : `AND COALESCE((SELECT lead_type FROM landos_deal_card WHERE id = o.legacy_deal_card_id), 'actual') <> 'test'`;
  const limit = Math.max(1, Math.min(options.limit ?? 500, 1000));
  args.push(limit);
  const rows = getLandosDb().prepare(`
    SELECT o.* FROM landos_opportunity o
    ${where.length ? `WHERE ${where.join(' AND ')}` : 'WHERE 1 = 1'}
    ${operatingFilter}
    ORDER BY updated_at DESC, id DESC LIMIT ?
  `).all(...args) as OpportunityDbRow[];
  return rows.map(mapRow);
}

export interface OpportunityBoardCard extends OpportunityRecord {
  dealCardId: number;
  address: string;
  apn: string;
  city: string;
  county: string;
  state: string;
  owner: string;
  acres: number | null;
  duplicateCandidates: Array<{ opportunityId: number; dealCardId: number; title: string }>;
}

/** Active Acquisitions projection: exactly one row per canonical opportunity.
 * Property/research records enrich the row; they never become extra cards. */
export function listOpportunityBoardCards(entity?: LandosEntity): OpportunityBoardCard[] {
  backfillLegacyOpportunities();
  const args: string[] = [];
  const entityWhere = entity ? 'AND o.entity = ?' : '';
  const operatingFilter = getLandosStorageProfile().syntheticOnly ? '' : "AND d.lead_type <> 'test'";
  if (entity) args.push(entity);
  const rows = getLandosDb().prepare(`
    SELECT o.*, d.deleted_at, p.active_input_address, p.address_key, p.apn,
           p.city, p.county, p.state, p.owner, p.acres
    FROM landos_opportunity o
    JOIN landos_deal_card d ON d.id = o.legacy_deal_card_id
    LEFT JOIN landos_property_card p ON p.id = o.primary_property_card_id
    WHERE o.lifecycle <> 'disposed' AND d.deleted_at IS NULL ${operatingFilter} ${entityWhere}
    ORDER BY o.updated_at DESC, o.id DESC
  `).all(...args) as Array<OpportunityDbRow & {
    active_input_address: string | null; address_key: string | null; apn: string | null;
    city: string | null; county: string | null; state: string | null; owner: string | null;
    acres: number | null;
  }>;
  return rows.map((row) => {
    const duplicates = rows.filter((other) => other.id !== row.id && (
      (!!row.apn && !!other.apn && row.apn.replace(/\D/g, '') === other.apn.replace(/\D/g, '')) ||
      (!!row.address_key && row.address_key === other.address_key)
    ));
    return {
      ...mapRow(row), dealCardId: row.legacy_deal_card_id!,
      address: row.active_input_address ?? '', apn: row.apn ?? '', city: row.city ?? '',
      county: row.county ?? '', state: row.state ?? '', owner: row.owner ?? '', acres: row.acres,
      duplicateCandidates: duplicates.map((other) => ({ opportunityId: other.id, dealCardId: other.legacy_deal_card_id!, title: other.title })),
    };
  });
}

export function setOpportunityPipelineStage(
  opportunityId: number,
  stage: OpportunityPipelineStage,
  actor = 'owner',
): OpportunityRecord {
  if (!(OPPORTUNITY_PIPELINE_STAGES as readonly string[]).includes(stage)) throw new Error(`invalid pipeline stage: ${stage}`);
  const current = getOpportunity(opportunityId);
  if (!current) throw new Error(`opportunity ${opportunityId} not found`);
  if (current.pipelineStage === stage) return current;
  if (stage === 'pursuing' && current.lifecycle === 'lead') ownerPursueOpportunity(opportunityId, { owner: actor });
  const now = nowSeconds();
  getLandosDb().prepare('UPDATE landos_opportunity SET pipeline_stage = ?, updated_at = ? WHERE id = ?').run(stage, now, opportunityId);
  insertHistory({ opportunityId, eventType: 'pipeline_stage_changed', decision: `${current.pipelineStage}->${stage}`, actor, occurredAt: now });
  return getOpportunity(opportunityId)!;
}

/** Keep the owner-facing opportunity title aligned with an accepted canonical
 * property identity while preserving raw_input as the original intake record. */
export function updateOpportunityTitle(
  opportunityId: number,
  title: string,
  input: { actor: string; note?: string },
): OpportunityRecord {
  const current = getOpportunity(opportunityId);
  if (!current) throw new Error(`opportunity ${opportunityId} not found`);
  const nextTitle = assertNonEmpty(title, 'title');
  if (current.title === nextTitle) return current;
  const now = nowSeconds();
  getLandosDb().prepare('UPDATE landos_opportunity SET title = ?, updated_at = ? WHERE id = ?').run(nextTitle, now, opportunityId);
  insertHistory({
    opportunityId,
    eventType: 'canonical_identity_updated',
    actor: assertNonEmpty(input.actor, 'actor'),
    note: input.note ?? `Canonical property identity updated from "${current.title}" to "${nextTitle}"; original intake retained in raw_input.`,
    occurredAt: now,
  });
  return getOpportunity(opportunityId)!;
}

function updateStatus(
  opportunityId: number,
  column: 'research_status' | 'discovery_status',
  status: OpportunityResearchStatus | OpportunityDiscoveryStatus,
  actor: string,
  note = '',
): OpportunityRecord {
  const db = getLandosDb();
  const opportunity = getOpportunity(opportunityId);
  if (!opportunity) throw new Error(`opportunity ${opportunityId} not found`);
  const previous = column === 'research_status' ? opportunity.researchStatus : opportunity.discoveryStatus;
  if (previous === status) return opportunity;
  const now = nowSeconds();
  db.prepare(`UPDATE landos_opportunity SET ${column} = ?, updated_at = ? WHERE id = ?`).run(status, now, opportunityId);
  insertHistory({
    opportunityId,
    eventType: `${column}_changed`,
    decision: `${previous}->${status}`,
    actor: assertNonEmpty(actor, 'actor'),
    note,
    occurredAt: now,
  });
  return getOpportunity(opportunityId)!;
}

export function updateOpportunityResearchStatus(
  opportunityId: number,
  status: OpportunityResearchStatus,
  input: { actor: string; note?: string },
): OpportunityRecord {
  if (!(OPPORTUNITY_RESEARCH_STATUSES as readonly string[]).includes(status)) throw new Error(`invalid research status: ${status}`);
  const updated = updateStatus(opportunityId, 'research_status', status, input.actor, input.note);
  if (updated.pipelineStage === 'new_lead' && ['queued', 'running', 'partial'].includes(status)) {
    return setOpportunityPipelineStage(opportunityId, 'researching', input.actor);
  }
  return updated;
}

export function updateOpportunityDiscoveryStatus(
  opportunityId: number,
  status: OpportunityDiscoveryStatus,
  input: { actor: string; note?: string },
): OpportunityRecord {
  if (!(OPPORTUNITY_DISCOVERY_STATUSES as readonly string[]).includes(status)) throw new Error(`invalid discovery status: ${status}`);
  const updated = updateStatus(opportunityId, 'discovery_status', status, input.actor, input.note);
  if (status === 'brief_ready' && ['new_lead', 'researching'].includes(updated.pipelineStage)) {
    return setOpportunityPipelineStage(opportunityId, 'discovery_ready', input.actor);
  }
  if (['call_complete', 'reconciled'].includes(status) && updated.lifecycle === 'lead') {
    return setOpportunityPipelineStage(opportunityId, 'discovery_complete', input.actor);
  }
  return updated;
}

export function updateOpportunityResearchStatusByDealCardId(
  dealCardId: number,
  status: OpportunityResearchStatus,
  input: { actor: string; note?: string },
): OpportunityRecord {
  return updateOpportunityResearchStatus(getOpportunityByDealCardId(dealCardId).id, status, input);
}

export function updateOpportunityDiscoveryStatusByDealCardId(
  dealCardId: number,
  status: OpportunityDiscoveryStatus,
  input: { actor: string; note?: string },
): OpportunityRecord {
  return updateOpportunityDiscoveryStatus(getOpportunityByDealCardId(dealCardId).id, status, input);
}

/** Owner pursuit promotes the same row. No Deal Card or second opportunity is created. */
export function ownerPursueOpportunity(
  opportunityId: number,
  input: { owner: string; note?: string },
): OpportunityRecord {
  const owner = assertOwner(input.owner);
  const db = getLandosDb();
  const opportunity = getOpportunity(opportunityId);
  if (!opportunity) throw new Error(`opportunity ${opportunityId} not found`);
  if (opportunity.lifecycle === 'disposed') throw new Error('disposed opportunity cannot be pursued without an explicit owner reopen decision');
  if (opportunity.lifecycle === 'deal') return opportunity;
  const now = nowSeconds();
  db.prepare(`
    UPDATE landos_opportunity
    SET lifecycle = 'deal', pipeline_stage = 'pursuing', disposition = NULL, pursued_at = ?, pursued_by = ?, updated_at = ?
    WHERE id = ?
  `).run(now, owner, now, opportunityId);
  insertHistory({
    opportunityId,
    eventType: 'owner_pursued',
    fromLifecycle: 'lead',
    toLifecycle: 'deal',
    decision: 'pursue',
    actor: owner,
    note: input.note,
    occurredAt: now,
  });
  return getOpportunity(opportunityId)!;
}

/** Owner disposition closes the same row and preserves any prior pursuit data. */
export function ownerDisposeOpportunity(
  opportunityId: number,
  input: { owner: string; disposition: string; note?: string },
): OpportunityRecord {
  const owner = assertOwner(input.owner);
  const disposition = assertNonEmpty(input.disposition, 'disposition');
  const db = getLandosDb();
  const opportunity = getOpportunity(opportunityId);
  if (!opportunity) throw new Error(`opportunity ${opportunityId} not found`);
  if (opportunity.lifecycle === 'disposed' && opportunity.disposition === disposition) return opportunity;
  const now = nowSeconds();
  db.prepare(`
    UPDATE landos_opportunity
    SET lifecycle = 'disposed', disposition = ?, updated_at = ?
    WHERE id = ?
  `).run(disposition, now, opportunityId);
  insertHistory({
    opportunityId,
    eventType: 'owner_disposed',
    fromLifecycle: opportunity.lifecycle,
    toLifecycle: 'disposed',
    decision: disposition,
    actor: owner,
    note: input.note,
    occurredAt: now,
  });
  return getOpportunity(opportunityId)!;
}

export function ownerPursueOpportunityByDealCardId(
  dealCardId: number,
  input: { owner: string; note?: string },
): OpportunityRecord {
  return ownerPursueOpportunity(getOpportunityByDealCardId(dealCardId).id, input);
}

export function ownerDisposeOpportunityByDealCardId(
  dealCardId: number,
  input: { owner: string; disposition: string; note?: string },
): OpportunityRecord {
  return ownerDisposeOpportunity(getOpportunityByDealCardId(dealCardId).id, input);
}

export interface ExecutiveOpportunityCounts {
  total: number;
  active: number;
  leads: number;
  deals: number;
  disposed: number;
  research: Record<OpportunityResearchStatus, number>;
  discovery: Record<OpportunityDiscoveryStatus, number>;
}

export interface ExecutiveOpportunitySnapshot {
  counts: ExecutiveOpportunityCounts;
  records: OpportunityRecord[];
}

/** One query contract for dashboard, Acquisitions, Jarvis, and DB drilldowns. */
export function getExecutiveOpportunitySnapshot(entity?: LandosEntity): ExecutiveOpportunitySnapshot {
  const records = listOpportunities({ entity, limit: 1000 });
  const research = Object.fromEntries(OPPORTUNITY_RESEARCH_STATUSES.map((status) => [status, 0])) as Record<OpportunityResearchStatus, number>;
  const discovery = Object.fromEntries(OPPORTUNITY_DISCOVERY_STATUSES.map((status) => [status, 0])) as Record<OpportunityDiscoveryStatus, number>;
  let leads = 0;
  let deals = 0;
  let disposed = 0;
  for (const record of records) {
    if (record.lifecycle === 'lead') leads++;
    else if (record.lifecycle === 'deal') deals++;
    else disposed++;
    research[record.researchStatus]++;
    discovery[record.discoveryStatus]++;
  }
  return {
    counts: { total: records.length, active: leads + deals, leads, deals, disposed, research, discovery },
    records,
  };
}

export function getExecutiveOpportunityCounts(entity?: LandosEntity): ExecutiveOpportunityCounts {
  return getExecutiveOpportunitySnapshot(entity).counts;
}
