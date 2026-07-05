// Browser Training Department — persistence layer.
//
// Thin, typed accessors over the landos_training_* tables. All storage is
// deterministic and local (store/landos.db). No secrets, no property work
// product, no paid-action data ever lands here — the security guard
// (training-security.ts) runs before anything is written.

import { getLandosDb } from './db.js';

export type TrainingSurface = 'tab' | 'window' | 'desktop';
export type TrainingSessionStatus = 'active' | 'paused' | 'ended' | 'aborted';
export type TrainingEventKind =
  | 'operator_speech'
  | 'ai_speech'
  | 'nav'
  | 'click'
  | 'input'
  | 'screenshot'
  | 'system'
  | 'guard_block';
export type PlaybookStatus = 'draft' | 'approved' | 'rejected' | 'superseded';
export type KnowledgeCategory =
  | 'business_rule'
  | 'provider_quirk'
  | 'operator_preference'
  | 'website_change'
  | 'observation'
  | 'never_do';
export type KnowledgeStatus = 'proposed' | 'saved' | 'discarded';

export interface TrainingSession {
  id: number;
  title: string;
  website: string;
  surface: TrainingSurface;
  status: TrainingSessionStatus;
  provider: string;
  model: string;
  dealCardId: number | null;
  approvalRequired: boolean;
  startedAt: number;
  endedAt: number | null;
  durationMs: number;
  audioInTokens: number;
  audioOutTokens: number;
  videoTokens: number;
  textTokens: number;
  estCostUsd: number;
  createdAt: number;
}

export interface TrainingEvent {
  id: number;
  sessionId: number;
  seq: number;
  kind: TrainingEventKind;
  role: string;
  text: string;
  url: string;
  selector: string;
  meta: Record<string, unknown>;
  createdAt: number;
}

export interface TrainingPlaybook {
  id: number;
  sessionId: number | null;
  slug: string;
  name: string;
  website: string;
  version: number;
  status: PlaybookStatus;
  body: Record<string, unknown>;
  sourceRef: string;
  decidedBy: string;
  decidedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface TrainingKnowledge {
  id: number;
  sessionId: number | null;
  category: KnowledgeCategory;
  title: string;
  body: string;
  website: string;
  status: KnowledgeStatus;
  createdAt: number;
}

// ── Sessions ─────────────────────────────────────────────────────────

export function createTrainingSession(input: {
  title?: string;
  website?: string;
  surface?: TrainingSurface;
  provider?: string;
  model?: string;
  dealCardId?: number | null;
}): TrainingSession {
  const db = getLandosDb();
  const info = db
    .prepare(
      `INSERT INTO landos_training_session (title, website, surface, provider, model, deal_card_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.title ?? '',
      input.website ?? '',
      input.surface ?? 'tab',
      input.provider ?? 'gemini',
      input.model ?? '',
      input.dealCardId ?? null,
    );
  return getTrainingSession(info.lastInsertRowid as number)!;
}

export function getTrainingSession(id: number): TrainingSession | null {
  const row = getLandosDb()
    .prepare('SELECT * FROM landos_training_session WHERE id = ?')
    .get(id) as Record<string, unknown> | undefined;
  return row ? rowToSession(row) : null;
}

export function listTrainingSessions(limit = 50): TrainingSession[] {
  return (
    getLandosDb()
      .prepare('SELECT * FROM landos_training_session ORDER BY created_at DESC, id DESC LIMIT ?')
      .all(limit) as Record<string, unknown>[]
  ).map(rowToSession);
}

export function updateTrainingSessionStatus(
  id: number,
  status: TrainingSessionStatus,
  opts: { approvalRequired?: boolean } = {},
): void {
  const db = getLandosDb();
  const ending = status === 'ended' || status === 'aborted';
  db.prepare(
    `UPDATE landos_training_session
       SET status = ?,
           approval_required = CASE WHEN ? IS NULL THEN approval_required ELSE ? END,
           ended_at = CASE WHEN ? AND ended_at IS NULL THEN strftime('%s','now') ELSE ended_at END,
           duration_ms = CASE WHEN ? AND duration_ms = 0
                              THEN (strftime('%s','now') - started_at) * 1000
                              ELSE duration_ms END
     WHERE id = ?`,
  ).run(
    status,
    opts.approvalRequired === undefined ? null : 1,
    opts.approvalRequired ? 1 : 0,
    ending ? 1 : 0,
    ending ? 1 : 0,
    id,
  );
}

/** Accumulate usage counters + recompute estimated cost. */
export function addTrainingUsage(
  id: number,
  delta: { audioIn?: number; audioOut?: number; video?: number; text?: number; costUsd?: number },
): void {
  getLandosDb()
    .prepare(
      `UPDATE landos_training_session
         SET audio_in_tokens = audio_in_tokens + ?,
             audio_out_tokens = audio_out_tokens + ?,
             video_tokens = video_tokens + ?,
             text_tokens = text_tokens + ?,
             est_cost_usd = est_cost_usd + ?
       WHERE id = ?`,
    )
    .run(delta.audioIn ?? 0, delta.audioOut ?? 0, delta.video ?? 0, delta.text ?? 0, delta.costUsd ?? 0, id);
}

// ── Events ───────────────────────────────────────────────────────────

export function appendTrainingEvent(input: {
  sessionId: number;
  kind: TrainingEventKind;
  role?: string;
  text?: string;
  url?: string;
  selector?: string;
  meta?: Record<string, unknown>;
}): TrainingEvent {
  const db = getLandosDb();
  const seqRow = db
    .prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM landos_training_event WHERE session_id = ?')
    .get(input.sessionId) as { next: number };
  const info = db
    .prepare(
      `INSERT INTO landos_training_event (session_id, seq, kind, role, text, url, selector, meta_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.sessionId,
      seqRow.next,
      input.kind,
      input.role ?? '',
      input.text ?? '',
      input.url ?? '',
      input.selector ?? '',
      JSON.stringify(input.meta ?? {}),
    );
  return getLandosDb()
    .prepare('SELECT * FROM landos_training_event WHERE id = ?')
    .get(info.lastInsertRowid as number) as never as TrainingEvent;
}

export function listTrainingEvents(sessionId: number): TrainingEvent[] {
  return (
    getLandosDb()
      .prepare('SELECT * FROM landos_training_event WHERE session_id = ? ORDER BY seq ASC')
      .all(sessionId) as Record<string, unknown>[]
  ).map(rowToEvent);
}

// ── Playbooks (with version history) ─────────────────────────────────

export function saveDraftPlaybook(input: {
  sessionId: number | null;
  slug: string;
  name: string;
  website: string;
  body: Record<string, unknown>;
  sourceRef?: string;
}): TrainingPlaybook {
  const db = getLandosDb();
  const prev = db
    .prepare('SELECT COALESCE(MAX(version), 0) AS v FROM landos_training_playbook WHERE slug = ?')
    .get(input.slug) as { v: number };
  const version = prev.v + 1;
  const info = db
    .prepare(
      `INSERT INTO landos_training_playbook (session_id, slug, name, website, version, status, body_json, source_ref)
       VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)`,
    )
    .run(
      input.sessionId,
      input.slug,
      input.name,
      input.website,
      version,
      JSON.stringify(input.body),
      input.sourceRef ?? '',
    );
  return getPlaybook(info.lastInsertRowid as number)!;
}

export function getPlaybook(id: number): TrainingPlaybook | null {
  const row = getLandosDb()
    .prepare('SELECT * FROM landos_training_playbook WHERE id = ?')
    .get(id) as Record<string, unknown> | undefined;
  return row ? rowToPlaybook(row) : null;
}

/** Latest version of each slug (for the list view). */
export function listLatestPlaybooks(limit = 50): TrainingPlaybook[] {
  return (
    getLandosDb()
      .prepare(
        `SELECT p.* FROM landos_training_playbook p
           JOIN (SELECT slug, MAX(version) AS mv FROM landos_training_playbook GROUP BY slug) m
             ON p.slug = m.slug AND p.version = m.mv
         ORDER BY p.updated_at DESC LIMIT ?`,
      )
      .all(limit) as Record<string, unknown>[]
  ).map(rowToPlaybook);
}

export function listPlaybookVersions(slug: string): TrainingPlaybook[] {
  return (
    getLandosDb()
      .prepare('SELECT * FROM landos_training_playbook WHERE slug = ? ORDER BY version DESC')
      .all(slug) as Record<string, unknown>[]
  ).map(rowToPlaybook);
}

/** Edit = new version (draft), previous stays as history. */
export function editPlaybook(id: number, body: Record<string, unknown>, name?: string): TrainingPlaybook {
  const cur = getPlaybook(id);
  if (!cur) throw new Error(`playbook ${id} not found`);
  return saveDraftPlaybook({
    sessionId: cur.sessionId,
    slug: cur.slug,
    name: name ?? cur.name,
    website: cur.website,
    body,
    sourceRef: cur.sourceRef,
  });
}

export function decidePlaybook(id: number, decision: 'approved' | 'rejected', decidedBy: string): TrainingPlaybook {
  const cur = getPlaybook(id);
  if (!cur) throw new Error(`playbook ${id} not found`);
  const db = getLandosDb();
  if (decision === 'approved') {
    // Supersede any previously approved version of the same slug.
    db.prepare(
      `UPDATE landos_training_playbook SET status = 'superseded', updated_at = strftime('%s','now')
       WHERE slug = ? AND status = 'approved' AND id != ?`,
    ).run(cur.slug, id);
  }
  db.prepare(
    `UPDATE landos_training_playbook
       SET status = ?, decided_by = ?, decided_at = strftime('%s','now'), updated_at = strftime('%s','now')
     WHERE id = ?`,
  ).run(decision, decidedBy, id);
  return getPlaybook(id)!;
}

export function getApprovedPlaybook(slug: string): TrainingPlaybook | null {
  const row = getLandosDb()
    .prepare(
      `SELECT * FROM landos_training_playbook WHERE slug = ? AND status = 'approved' ORDER BY version DESC LIMIT 1`,
    )
    .get(slug) as Record<string, unknown> | undefined;
  return row ? rowToPlaybook(row) : null;
}

// ── Knowledge ────────────────────────────────────────────────────────

export function saveKnowledgeItem(input: {
  sessionId: number | null;
  category: KnowledgeCategory;
  title: string;
  body: string;
  website?: string;
  status?: KnowledgeStatus;
}): TrainingKnowledge {
  const db = getLandosDb();
  const info = db
    .prepare(
      `INSERT INTO landos_training_knowledge (session_id, category, title, body, website, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.sessionId,
      input.category,
      input.title,
      input.body,
      input.website ?? '',
      input.status ?? 'proposed',
    );
  return getLandosDb()
    .prepare('SELECT * FROM landos_training_knowledge WHERE id = ?')
    .get(info.lastInsertRowid as number) as never as TrainingKnowledge;
}

export function listKnowledge(opts: { sessionId?: number; status?: KnowledgeStatus } = {}): TrainingKnowledge[] {
  const clauses: string[] = [];
  const args: unknown[] = [];
  if (opts.sessionId !== undefined) {
    clauses.push('session_id = ?');
    args.push(opts.sessionId);
  }
  if (opts.status) {
    clauses.push('status = ?');
    args.push(opts.status);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return (
    getLandosDb()
      .prepare(`SELECT * FROM landos_training_knowledge ${where} ORDER BY created_at DESC`)
      .all(...args) as Record<string, unknown>[]
  ).map(rowToKnowledge);
}

export function setKnowledgeStatus(id: number, status: KnowledgeStatus): void {
  getLandosDb().prepare('UPDATE landos_training_knowledge SET status = ? WHERE id = ?').run(status, id);
}

// ── Field selector bindings ──────────────────────────────────────────

export interface FieldBindingRow {
  id: number;
  sessionId: number;
  field: string;
  selector: string;
  label: string;
  sampleValue: string;
  confidence: string;
  strategy: string;
  createdAt: number;
  updatedAt: number;
}

/** Upsert a field binding (latest per session+field wins). */
export function upsertFieldBinding(input: {
  sessionId: number;
  field: string;
  selector: string;
  label: string;
  sampleValue?: string;
  confidence: string;
  strategy: string;
}): FieldBindingRow {
  const db = getLandosDb();
  db.prepare(
    `INSERT INTO landos_training_field_binding (session_id, field, selector, label, sample_value, confidence, strategy)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(session_id, field) DO UPDATE SET
       selector = excluded.selector, label = excluded.label, sample_value = excluded.sample_value,
       confidence = excluded.confidence, strategy = excluded.strategy, updated_at = strftime('%s','now')`,
  ).run(input.sessionId, input.field, input.selector, input.label, input.sampleValue ?? '', input.confidence, input.strategy);
  return getFieldBinding(input.sessionId, input.field)!;
}

export function getFieldBinding(sessionId: number, field: string): FieldBindingRow | null {
  const r = getLandosDb()
    .prepare('SELECT * FROM landos_training_field_binding WHERE session_id = ? AND field = ?')
    .get(sessionId, field) as Record<string, unknown> | undefined;
  return r ? rowToBinding(r) : null;
}

export function listFieldBindings(sessionId: number): FieldBindingRow[] {
  return (
    getLandosDb()
      .prepare('SELECT * FROM landos_training_field_binding WHERE session_id = ? ORDER BY field ASC')
      .all(sessionId) as Record<string, unknown>[]
  ).map(rowToBinding);
}

function rowToBinding(r: Record<string, unknown>): FieldBindingRow {
  return {
    id: r.id as number,
    sessionId: r.session_id as number,
    field: (r.field as string) ?? '',
    selector: (r.selector as string) ?? '',
    label: (r.label as string) ?? '',
    sampleValue: (r.sample_value as string) ?? '',
    confidence: (r.confidence as string) ?? 'low',
    strategy: (r.strategy as string) ?? 'label',
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number,
  };
}

// ── Execution results ────────────────────────────────────────────────

export type ExecutionMode = 'dry_run' | 'live';
export type ExecutionStatus =
  | 'succeeded'
  | 'partial'
  | 'blocked'
  | 'failed'
  | 'not_configured'
  | 'awaiting_authentication';

export interface ExtractedField {
  field: string;
  value: string;
  selector: string;
  written: boolean;
  confidence?: string;
  strategy?: string;
}
export interface BlockedAction { step: number; action: string; url: string; reason: string }

export interface TrainingExecution {
  id: number;
  playbookId: number;
  playbookSlug: string;
  agentRunId: string;
  dealCardId: number | null;
  mode: ExecutionMode;
  status: ExecutionStatus;
  approvalRequired: boolean;
  fieldsWritten: number;
  extractedFields: ExtractedField[];
  blockedActions: BlockedAction[];
  errors: string[];
  screenshots: string[];
  qaNotes: string;
  createdAt: number;
}

export function saveTrainingExecution(input: {
  playbookId: number;
  playbookSlug: string;
  agentRunId: string;
  dealCardId?: number | null;
  mode: ExecutionMode;
  status: ExecutionStatus;
  approvalRequired: boolean;
  fieldsWritten: number;
  extractedFields: ExtractedField[];
  blockedActions: BlockedAction[];
  errors: string[];
  screenshots: string[];
  qaNotes: string;
}): TrainingExecution {
  const db = getLandosDb();
  const info = db
    .prepare(
      `INSERT INTO landos_training_execution
        (playbook_id, playbook_slug, agent_run_id, deal_card_id, mode, status, approval_required,
         fields_written, extracted_fields_json, blocked_actions_json, errors_json, screenshots_json, qa_notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.playbookId,
      input.playbookSlug,
      input.agentRunId,
      input.dealCardId ?? null,
      input.mode,
      input.status,
      input.approvalRequired ? 1 : 0,
      input.fieldsWritten,
      JSON.stringify(input.extractedFields),
      JSON.stringify(input.blockedActions),
      JSON.stringify(input.errors),
      JSON.stringify(input.screenshots),
      input.qaNotes,
    );
  return getTrainingExecution(info.lastInsertRowid as number)!;
}

export function getTrainingExecution(id: number): TrainingExecution | null {
  const row = getLandosDb()
    .prepare('SELECT * FROM landos_training_execution WHERE id = ?')
    .get(id) as Record<string, unknown> | undefined;
  return row ? rowToExecution(row) : null;
}

export function listTrainingExecutions(playbookId?: number, limit = 25): TrainingExecution[] {
  const db = getLandosDb();
  const rows = (
    playbookId
      ? db.prepare('SELECT * FROM landos_training_execution WHERE playbook_id = ? ORDER BY created_at DESC, id DESC LIMIT ?').all(playbookId, limit)
      : db.prepare('SELECT * FROM landos_training_execution ORDER BY created_at DESC, id DESC LIMIT ?').all(limit)
  ) as Record<string, unknown>[];
  return rows.map(rowToExecution);
}

function rowToExecution(r: Record<string, unknown>): TrainingExecution {
  const arr = <T,>(s: unknown): T[] => {
    try { const v = JSON.parse((s as string) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
  };
  return {
    id: r.id as number,
    playbookId: r.playbook_id as number,
    playbookSlug: (r.playbook_slug as string) ?? '',
    agentRunId: (r.agent_run_id as string) ?? '',
    dealCardId: (r.deal_card_id as number | null) ?? null,
    mode: (r.mode as ExecutionMode) ?? 'dry_run',
    status: (r.status as ExecutionStatus) ?? 'succeeded',
    approvalRequired: !!(r.approval_required as number),
    fieldsWritten: (r.fields_written as number) ?? 0,
    extractedFields: arr<ExtractedField>(r.extracted_fields_json),
    blockedActions: arr<BlockedAction>(r.blocked_actions_json),
    errors: arr<string>(r.errors_json),
    screenshots: arr<string>(r.screenshots_json),
    qaNotes: (r.qa_notes as string) ?? '',
    createdAt: r.created_at as number,
  };
}

// ── Row mappers ──────────────────────────────────────────────────────

function rowToSession(r: Record<string, unknown>): TrainingSession {
  return {
    id: r.id as number,
    title: (r.title as string) ?? '',
    website: (r.website as string) ?? '',
    surface: (r.surface as TrainingSurface) ?? 'tab',
    status: (r.status as TrainingSessionStatus) ?? 'active',
    provider: (r.provider as string) ?? 'gemini',
    model: (r.model as string) ?? '',
    dealCardId: (r.deal_card_id as number | null) ?? null,
    approvalRequired: !!(r.approval_required as number),
    startedAt: r.started_at as number,
    endedAt: (r.ended_at as number | null) ?? null,
    durationMs: (r.duration_ms as number) ?? 0,
    audioInTokens: (r.audio_in_tokens as number) ?? 0,
    audioOutTokens: (r.audio_out_tokens as number) ?? 0,
    videoTokens: (r.video_tokens as number) ?? 0,
    textTokens: (r.text_tokens as number) ?? 0,
    estCostUsd: (r.est_cost_usd as number) ?? 0,
    createdAt: r.created_at as number,
  };
}

function rowToEvent(r: Record<string, unknown>): TrainingEvent {
  let meta: Record<string, unknown> = {};
  try {
    meta = JSON.parse((r.meta_json as string) || '{}');
  } catch {
    meta = {};
  }
  return {
    id: r.id as number,
    sessionId: r.session_id as number,
    seq: r.seq as number,
    kind: r.kind as TrainingEventKind,
    role: (r.role as string) ?? '',
    text: (r.text as string) ?? '',
    url: (r.url as string) ?? '',
    selector: (r.selector as string) ?? '',
    meta,
    createdAt: r.created_at as number,
  };
}

function rowToPlaybook(r: Record<string, unknown>): TrainingPlaybook {
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse((r.body_json as string) || '{}');
  } catch {
    body = {};
  }
  return {
    id: r.id as number,
    sessionId: (r.session_id as number | null) ?? null,
    slug: (r.slug as string) ?? '',
    name: (r.name as string) ?? '',
    website: (r.website as string) ?? '',
    version: (r.version as number) ?? 1,
    status: (r.status as PlaybookStatus) ?? 'draft',
    body,
    sourceRef: (r.source_ref as string) ?? '',
    decidedBy: (r.decided_by as string) ?? '',
    decidedAt: (r.decided_at as number | null) ?? null,
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number,
  };
}

function rowToKnowledge(r: Record<string, unknown>): TrainingKnowledge {
  return {
    id: r.id as number,
    sessionId: (r.session_id as number | null) ?? null,
    category: r.category as KnowledgeCategory,
    title: (r.title as string) ?? '',
    body: (r.body as string) ?? '',
    website: (r.website as string) ?? '',
    status: (r.status as KnowledgeStatus) ?? 'proposed',
    createdAt: r.created_at as number,
  };
}
