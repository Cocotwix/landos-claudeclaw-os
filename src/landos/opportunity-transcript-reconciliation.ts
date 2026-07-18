// Phase 1 human-call transcript ingestion and deterministic reconciliation.
//
// This module performs no network/model/provider work. It preserves the exact
// operator-supplied transcript, compares explicit seller claims with the stored
// discovery package, and records every derived canonical value with provenance.

import { createHash } from 'node:crypto';
import path from 'node:path';

import { getLandosDb } from './db.js';
import { getStoredDiscoveryPackage, type DiscoveryPackage } from './opportunity-discovery-package.js';
import {
  getOpportunity,
  updateOpportunityDiscoveryStatus,
  type OpportunityRecord,
} from './opportunity.js';

export type TranscriptSourceType = 'paste' | 'upload';
export type ReconciliationNextAction =
  | 'deeper_underwriting' | 'more_research' | 'prepare_offer' | 'follow_up' | 'nurture'
  | 'dead_lead' | 'wrong_property' | 'do_not_contact';

export interface OpportunityTranscript {
  id: number;
  opportunityId: number;
  sourceType: TranscriptSourceType;
  fileName: string | null;
  contentSha256: string;
  rawText: string;
  capturedBy: string;
  createdAt: number;
}

export interface ReconciledStatement {
  field: string;
  value: string | number | string[];
  evidence: string;
  classification: 'seller_stated';
}

export interface ReconciliationConflict {
  field: string;
  sellerValue: string | number;
  currentValue: string | number;
  material: boolean;
  explanation: string;
}

export interface ReconciliationTask {
  type: 'research' | 'follow_up';
  title: string;
  assignedRole: 'Property Research Agent' | 'Acquisitions Agent';
}

export interface ReconciliationTaskRecord extends ReconciliationTask {
  id: number;
  reconciliationId: number;
  status: 'open' | 'complete' | 'cancelled';
  createdAt: number;
  updatedAt: number;
}

export interface OpportunityReconciliation {
  id: number;
  opportunityId: number;
  transcriptId: number;
  version: number;
  discoveryPackageHash: string | null;
  summary: string;
  sellerStatements: ReconciledStatement[];
  verifiedFacts: Array<{ field: string; value: string | number | boolean; source: string | null }>;
  parties: Array<{ name: string; role: 'seller' | 'owner' | 'heir' | 'decision_maker'; authorityStatus: 'unverified' }>;
  motivation: { score: number; evidence: string[]; label: 'low' | 'medium' | 'high' };
  askingPrice: number | null;
  timeline: string | null;
  propertyStatements: ReconciledStatement[];
  contradictions: ReconciliationConflict[];
  materialConflict: boolean;
  researchTasks: ReconciliationTask[];
  followUpTasks: ReconciliationTask[];
  nextAction: ReconciliationNextAction;
  safety: {
    outboundAllowed: false;
    paidActionsAllowed: false;
    offerOrContractSendingAllowed: false;
    note: string;
  };
  reconciledBy: string;
  createdAt: number;
}

interface TranscriptRow {
  id: number; opportunity_id: number; source_type: TranscriptSourceType;
  file_name: string | null; content_sha256: string; raw_text: string;
  captured_by: string; created_at: number;
}

interface ReconciliationRow {
  id: number; opportunity_id: number; transcript_id: number; version: number;
  discovery_package_hash: string | null; reconciliation_json: string;
  reconciled_by: string; created_at: number;
}

const clean = (value: string): string => value.replace(/\s+/g, ' ').trim();
const unique = <T>(items: T[]): T[] => [...new Set(items)];

function mapTranscript(row: TranscriptRow): OpportunityTranscript {
  return {
    id: row.id, opportunityId: row.opportunity_id, sourceType: row.source_type,
    fileName: row.file_name, contentSha256: row.content_sha256, rawText: row.raw_text,
    capturedBy: row.captured_by, createdAt: row.created_at,
  };
}

function mapReconciliation(row: ReconciliationRow): OpportunityReconciliation {
  const value = JSON.parse(row.reconciliation_json) as Omit<OpportunityReconciliation, 'id' | 'opportunityId' | 'transcriptId' | 'version' | 'discoveryPackageHash' | 'reconciledBy' | 'createdAt'>;
  return {
    id: row.id, opportunityId: row.opportunity_id, transcriptId: row.transcript_id,
    version: row.version, discoveryPackageHash: row.discovery_package_hash,
    ...value, reconciledBy: row.reconciled_by, createdAt: row.created_at,
  };
}

function excerpt(text: string, index: number, length: number): string {
  const start = Math.max(0, text.lastIndexOf('.', index) + 1);
  const endCandidates = [text.indexOf('.', index + length), text.indexOf('\n', index + length)].filter((n) => n >= 0);
  const end = endCandidates.length ? Math.min(...endCandidates) + 1 : Math.min(text.length, index + length + 100);
  return clean(text.slice(start, end)).slice(0, 300);
}

function firstMatch(text: string, patterns: RegExp[]): { value: string; evidence: string } | null {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[1]) return { value: clean(match[1]), evidence: excerpt(text, match.index, match[0].length) };
  }
  return null;
}

function parseMoney(raw: string): number | null {
  const suffix = /k$/i.test(raw.trim()) ? 1000 : 1;
  const parsed = Number(raw.replace(/[$,\s]/g, '').replace(/k$/i, '')) * suffix;
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null;
}

function norm(value: unknown): string {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function extractParties(text: string, discoveryPackage: DiscoveryPackage | undefined): OpportunityReconciliation['parties'] {
  const parties: OpportunityReconciliation['parties'] = [];
  const add = (name: string, role: OpportunityReconciliation['parties'][number]['role']) => {
    const cleaned = clean(name).replace(/[.,;:]+$/, '');
    if (cleaned.length < 2 || /^(me|myself|us|unknown)$/i.test(cleaned)) return;
    if (!parties.some((item) => norm(item.name) === norm(cleaned) && item.role === role)) {
      parties.push({ name: cleaned, role, authorityStatus: 'unverified' });
    }
  };
  for (const contact of discoveryPackage?.identity.contacts ?? []) add(contact.name, /owner/i.test(contact.role) ? 'owner' : 'seller');
  const patterns: Array<[RegExp, OpportunityReconciliation['parties'][number]['role']]> = [
    [/(?:owner|co-owner)(?: is|:| named)?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})/g, 'owner'],
    [/(?:heir|daughter|son|brother|sister|spouse)(?: is|:| named)?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})/g, 'heir'],
    [/(?:decision[- ]maker|must approve|needs? to approve)(?: is|:)?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})/g, 'decision_maker'],
  ];
  for (const [pattern, role] of patterns) for (const match of text.matchAll(pattern)) if (match[1]) add(match[1], role);
  return parties;
}

function analyzeTranscript(rawText: string, discoveryPackage: DiscoveryPackage | undefined) {
  const text = clean(rawText);
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const summary = sentences.slice(0, 3).join(' ').slice(0, 700) || 'Discovery call transcript captured; structured details require operator review.';
  const asking = firstMatch(text, [
    /(?:asking|ask(?:ing)? price|want(?:s|ed)?|looking for|price)(?: is|:| of| about| around)?\s*(\$?\s*[\d,.]+\s*[kK]?)/i,
  ]);
  const askingPrice = asking ? parseMoney(asking.value) : null;
  const timelineMatch = firstMatch(text, [
    /(?:timeline|close|sell|need(?:s)? to sell|want(?:s)? to sell)(?: is|:| in| within| by| about| around)?\s+((?:within\s+)?\d+\s+(?:day|week|month|year)s?|as soon as possible|ASAP|this month|next month|by [A-Za-z]+(?:\s+\d{1,2})?)/i,
  ]);
  const acresMatch = firstMatch(text, [/(?:property|parcel|land|it)(?: is| has|:| about| around)?\s*(\d+(?:\.\d+)?)\s*acres?/i, /(\d+(?:\.\d+)?)\s*acres?/i]);
  const apnMatch = firstMatch(text, [/(?:APN|parcel(?: number| id)?)(?: is|:| #)?\s*([A-Z0-9][A-Z0-9 -]{3,30})/i]);
  const accessMatch = firstMatch(text, [/(?:access|road frontage)(?: is|:| has| via)?\s+([^.;]{3,100})/i]);
  const conditionMatch = firstMatch(text, [/(?:condition|improvements?)(?: is|:| include(?:s)?| has)?\s+([^.;]{3,120})/i]);
  const statements: ReconciledStatement[] = [];
  const add = (field: string, value: string | number | string[] | null, evidence: string | null) => {
    if (value == null || value === '') return;
    statements.push({ field, value, evidence: evidence || String(value), classification: 'seller_stated' });
  };
  add('asking_price', askingPrice, asking?.evidence ?? null);
  add('timeline', timelineMatch?.value ?? null, timelineMatch?.evidence ?? null);
  add('acreage', acresMatch ? Number(acresMatch.value) : null, acresMatch?.evidence ?? null);
  add('apn', apnMatch?.value ?? null, apnMatch?.evidence ?? null);
  add('access', accessMatch?.value ?? null, accessMatch?.evidence ?? null);
  add('condition', conditionMatch?.value ?? null, conditionMatch?.evidence ?? null);

  const motivationSignals = [
    { label: 'Inherited/estate ownership', pattern: /inherit|estate|probate/i },
    { label: 'Tax or debt pressure', pattern: /tax|behind|lien|debt/i },
    { label: 'Time urgency', pattern: /urgent|asap|sell quickly|need to sell|within \d+ days/i },
    { label: 'Life-event pressure', pattern: /relocat|medical|divorc|job loss/i },
    { label: 'Property burden or no use', pattern: /tired|vacant|burden|no use|do not use/i },
    { label: 'Explicit cash need', pattern: /need money|need cash/i },
  ];
  const motivationEvidence = motivationSignals.flatMap(({ label, pattern }) => {
    const sentence = sentences.find((item) => pattern.test(item));
    return sentence ? [`${label}: ${sentence.slice(0, 240)}`] : [];
  }).slice(0, 6);
  if (!motivationEvidence.length) motivationEvidence.push('No explicit motivation signal was identified in the transcript; confirm motivation on follow-up.');
  const positiveSignalCount = motivationEvidence[0]?.startsWith('No explicit') ? 0 : motivationEvidence.length;
  const score = Math.min(10, positiveSignalCount === 0 ? 1 : 2 + positiveSignalCount * 2);
  const motivation = { score, evidence: motivationEvidence, label: score >= 7 ? 'high' as const : score >= 4 ? 'medium' as const : 'low' as const };
  if (motivationEvidence.length) add('motivation', motivationEvidence, motivationEvidence.join(' '));

  const verifiedFacts = [
    ...(discoveryPackage?.callPrep.knownFacts ?? []).map((fact) => ({ field: fact.key, value: fact.value, source: fact.source })),
    ...(['address', 'city', 'county', 'state', 'apn'] as const).flatMap((field) => {
      const value = discoveryPackage?.identity[field];
      return value == null || value === '' ? [] : [{ field, value, source: 'Discovery package identity' }];
    }),
  ].filter((fact): fact is { field: string; value: string | number | boolean; source: string | null } => fact.value != null);

  const contradictions: ReconciliationConflict[] = [];
  const compare = (field: string, sellerValue: string | number | null, currentValue: string | number | null | undefined, material = true) => {
    if (sellerValue == null || currentValue == null || String(currentValue).trim() === '') return;
    const differs = typeof sellerValue === 'number' && typeof currentValue === 'number'
      ? Math.abs(sellerValue - currentValue) > Math.max(0.1, Math.abs(currentValue) * 0.02)
      : norm(sellerValue) !== norm(currentValue);
    if (differs) contradictions.push({ field, sellerValue, currentValue, material, explanation: `Seller-stated ${field} differs from the current discovery-package value; preserve both and verify before reliance.` });
  };
  compare('apn', apnMatch?.value ?? null, discoveryPackage?.identity.apn, true);
  const researchedAcreageRaw = discoveryPackage?.landCharacteristics.find((fact) => /acre/i.test(`${fact.key} ${fact.label}`))?.value;
  const researchedAcreage = typeof researchedAcreageRaw === 'number'
    ? researchedAcreageRaw
    : typeof researchedAcreageRaw === 'string' && researchedAcreageRaw.trim() !== '' && Number.isFinite(Number(researchedAcreageRaw))
      ? Number(researchedAcreageRaw) : null;
  compare('acreage', acresMatch ? Number(acresMatch.value) : null, researchedAcreage, true);

  const propertyStatements = statements.filter((item) => ['acreage', 'apn', 'access', 'condition'].includes(item.field));
  const researchTasks: ReconciliationTask[] = contradictions.map((conflict) => ({
    type: 'research', title: `Resolve ${conflict.field} conflict (${conflict.sellerValue} vs ${conflict.currentValue})`, assignedRole: 'Property Research Agent',
  }));
  if (!discoveryPackage?.identity.resolved) researchTasks.push({ type: 'research', title: 'Resolve exact subject parcel identity from seller call clues and public records', assignedRole: 'Property Research Agent' });
  const followUpTasks: ReconciliationTask[] = [];
  if (askingPrice == null) followUpTasks.push({ type: 'follow_up', title: 'Confirm seller asking price or price expectations', assignedRole: 'Acquisitions Agent' });
  if (!timelineMatch) followUpTasks.push({ type: 'follow_up', title: 'Confirm seller timeline and desired closing date', assignedRole: 'Acquisitions Agent' });
  const callback = firstMatch(text, [/(call (?:me|us) (?:back )?(?:on|after|in|next|tomorrow|later)[^.;]{0,80})/i]);
  if (callback) followUpTasks.push({ type: 'follow_up', title: `Owner review: ${callback.value}`, assignedRole: 'Acquisitions Agent' });
  const parties = extractParties(rawText, discoveryPackage);
  if (!parties.some((party) => party.role === 'owner' || party.role === 'decision_maker')) followUpTasks.push({ type: 'follow_up', title: 'Confirm all owners, heirs, decision-makers, and signing authority', assignedRole: 'Acquisitions Agent' });

  let nextAction: ReconciliationNextAction = researchTasks.length ? 'more_research' : followUpTasks.length ? 'follow_up' : 'deeper_underwriting';
  if (!researchTasks.length && !followUpTasks.length && discoveryPackage?.identity.resolved
      && discoveryPackage.preliminaryValue?.ownerReviewAcquisitionRange40To60Pct) {
    // Internal recommendation vocabulary only. This does not create, approve,
    // send, or authorize an offer; owner review remains mandatory.
    nextAction = 'prepare_offer';
  }
  if (/do not (?:call|contact)|stop calling/i.test(text)) nextAction = 'do_not_contact';
  else if (/wrong (?:property|parcel)|not (?:my|our) property/i.test(text)) nextAction = 'wrong_property';
  else if (/not interested|never sell|dead lead/i.test(text)) nextAction = 'dead_lead';
  else if (/call (?:me|us) (?:in|next)|next year|not ready/i.test(text)) nextAction = 'nurture';

  return {
    summary, sellerStatements: statements, verifiedFacts, parties, motivation,
    askingPrice, timeline: timelineMatch?.value ?? null, propertyStatements,
    contradictions, materialConflict: contradictions.some((item) => item.material),
    researchTasks: uniqueTasks(researchTasks), followUpTasks: uniqueTasks(followUpTasks), nextAction,
    safety: {
      outboundAllowed: false as const, paidActionsAllowed: false as const, offerOrContractSendingAllowed: false as const,
      note: 'Internal reconciliation only. Max may communicate outbound only with the owner; paid actions and offer/contract sending remain prohibited.',
    },
  };
}

function uniqueTasks(tasks: ReconciliationTask[]): ReconciliationTask[] {
  const seen = new Set<string>();
  return tasks.filter((task) => { const key = `${task.type}:${task.title}`; if (seen.has(key)) return false; seen.add(key); return true; });
}

function insertFactsAndTasks(reconciliationId: number, transcriptId: number, opportunityId: number, analysis: ReturnType<typeof analyzeTranscript>, actor: string): void {
  const db = getLandosDb();
  for (const statement of analysis.sellerStatements) {
    // A seller statement can supersede only an earlier seller statement. It
    // never supersedes, downgrades, or overwrites a verified fact.
    const previous = db.prepare(`SELECT id FROM landos_opportunity_canonical_fact WHERE opportunity_id = ? AND field_key = ? AND classification = 'seller_stated' ORDER BY created_at DESC, id DESC LIMIT 1`).get(opportunityId, statement.field) as { id: number } | undefined;
    const conflict = analysis.contradictions.find((item) => item.field === statement.field);
    db.prepare(`INSERT INTO landos_opportunity_canonical_fact
      (opportunity_id, field_key, value_json, classification, transcript_id, reconciliation_id, conflict_status, supersedes_fact_id, recorded_by)
      VALUES (?, ?, ?, 'seller_stated', ?, ?, ?, ?, ?)`)
      .run(opportunityId, statement.field, JSON.stringify(statement.value), transcriptId, reconciliationId, conflict?.material ? 'material' : conflict ? 'possible' : 'none', previous?.id ?? null, actor);
  }
  for (const task of [...analysis.researchTasks, ...analysis.followUpTasks]) {
    db.prepare(`INSERT INTO landos_opportunity_reconciliation_task
      (opportunity_id, reconciliation_id, task_type, title, assigned_role)
      VALUES (?, ?, ?, ?, ?)`)
      .run(opportunityId, reconciliationId, task.type, task.title, task.assignedRole);
  }
}

export function ingestAndReconcileTranscript(input: {
  opportunityId: number; content: string; sourceType: TranscriptSourceType;
  fileName?: string | null; actor?: string;
}): { transcript: OpportunityTranscript; reconciliation: OpportunityReconciliation; tasks: ReconciliationTaskRecord[]; opportunity: OpportunityRecord } {
  const opportunity = getOpportunity(input.opportunityId);
  if (!opportunity) throw new Error(`opportunity ${input.opportunityId} not found`);
  // Validate against a normalized view, but preserve and hash the exact string
  // supplied by the operator, including BOM/newlines/leading whitespace.
  const rawText = input.content;
  if (!rawText.trim()) throw new Error('transcript content is required');
  if (Buffer.byteLength(rawText, 'utf8') > 2_000_000) throw new Error('transcript content exceeds 2 MB UTF-8 text limit');
  if (rawText.includes('\0') || rawText.includes('\uFFFD')) throw new Error('transcript must be valid UTF-8 text');
  if (input.sourceType !== 'paste' && input.sourceType !== 'upload') throw new Error('sourceType must be paste or upload');
  const suppliedName = input.fileName?.trim() || 'transcript.txt';
  const fileName = input.sourceType === 'upload'
    ? path.basename(path.win32.basename(suppliedName)).replace(/[\u0000-\u001f\u007f]/g, '')
    : null;
  if (fileName && !/\.(txt|text|md)$/i.test(fileName)) throw new Error('initial transcript upload supports text files only');
  const actor = input.actor?.trim() || 'operator';
  const hash = createHash('sha256').update(rawText, 'utf8').digest('hex');
  const db = getLandosDb();

  const stored = db.transaction(() => {
    const duplicate = db.prepare(`SELECT * FROM landos_opportunity_transcript WHERE opportunity_id = ? AND content_sha256 = ?`).get(input.opportunityId, hash) as TranscriptRow | undefined;
    if (duplicate) {
      const existing = db.prepare(`SELECT * FROM landos_opportunity_reconciliation WHERE transcript_id = ?`).get(duplicate.id) as ReconciliationRow;
      return { transcript: mapTranscript(duplicate), reconciliation: mapReconciliation(existing) };
    }
    const transcriptResult = db.prepare(`INSERT INTO landos_opportunity_transcript
      (opportunity_id, source_type, file_name, content_sha256, raw_text, captured_by)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run(input.opportunityId, input.sourceType, fileName, hash, rawText, actor);
    const transcriptId = Number(transcriptResult.lastInsertRowid);
    const discoveryPackage = getStoredDiscoveryPackage(input.opportunityId);
    const analysis = analyzeTranscript(rawText, discoveryPackage);
    const prior = db.prepare(`SELECT COALESCE(MAX(version), 0) AS version FROM landos_opportunity_reconciliation WHERE opportunity_id = ?`).get(input.opportunityId) as { version: number };
    const version = prior.version + 1;
    const reconciledBy = 'Max + Acquisitions Agent';
    const result = db.prepare(`INSERT INTO landos_opportunity_reconciliation
      (opportunity_id, transcript_id, version, discovery_package_hash, reconciliation_json, reconciled_by)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run(input.opportunityId, transcriptId, version, discoveryPackage?.contentHash ?? null, JSON.stringify(analysis), reconciledBy);
    const reconciliationId = Number(result.lastInsertRowid);
    insertFactsAndTasks(reconciliationId, transcriptId, input.opportunityId, analysis, reconciledBy);
    const transcriptRow = db.prepare('SELECT * FROM landos_opportunity_transcript WHERE id = ?').get(transcriptId) as TranscriptRow;
    const reconciliationRow = db.prepare('SELECT * FROM landos_opportunity_reconciliation WHERE id = ?').get(reconciliationId) as ReconciliationRow;
    return { transcript: mapTranscript(transcriptRow), reconciliation: mapReconciliation(reconciliationRow) };
  })();

  const updated = updateOpportunityDiscoveryStatus(input.opportunityId, 'reconciled', {
    actor: 'Max + Acquisitions Agent', note: `Transcript ${stored.transcript.id} reconciled as version ${stored.reconciliation.version}; seller statements retain explicit provenance.`,
  });
  return { ...stored, tasks: listOpportunityReconciliationTasks(input.opportunityId, stored.reconciliation.id), opportunity: updated };
}

export function listOpportunityTranscripts(opportunityId: number): OpportunityTranscript[] {
  return (getLandosDb().prepare(`SELECT * FROM landos_opportunity_transcript WHERE opportunity_id = ? ORDER BY created_at DESC, id DESC`).all(opportunityId) as TranscriptRow[]).map(mapTranscript);
}

export function getLatestOpportunityReconciliation(opportunityId: number): OpportunityReconciliation | undefined {
  const row = getLandosDb().prepare(`SELECT * FROM landos_opportunity_reconciliation WHERE opportunity_id = ? ORDER BY version DESC LIMIT 1`).get(opportunityId) as ReconciliationRow | undefined;
  return row ? mapReconciliation(row) : undefined;
}

export function listOpportunityReconciliations(opportunityId: number): OpportunityReconciliation[] {
  return (getLandosDb().prepare(`SELECT * FROM landos_opportunity_reconciliation WHERE opportunity_id = ? ORDER BY version DESC`).all(opportunityId) as ReconciliationRow[]).map(mapReconciliation);
}

export function listOpportunityReconciliationTasks(opportunityId: number, reconciliationId?: number): ReconciliationTaskRecord[] {
  const rows = getLandosDb().prepare(`SELECT id, reconciliation_id, task_type, title, status, assigned_role, created_at, updated_at
    FROM landos_opportunity_reconciliation_task
    WHERE opportunity_id = ? ${reconciliationId == null ? '' : 'AND reconciliation_id = ?'}
    ORDER BY status = 'open' DESC, created_at DESC, id DESC`)
    .all(...(reconciliationId == null ? [opportunityId] : [opportunityId, reconciliationId])) as Array<{
      id: number; reconciliation_id: number; task_type: ReconciliationTask['type']; title: string;
      status: ReconciliationTaskRecord['status']; assigned_role: ReconciliationTask['assignedRole'];
      created_at: number; updated_at: number;
    }>;
  return rows.map((row) => ({
    id: row.id, reconciliationId: row.reconciliation_id, type: row.task_type, title: row.title,
    status: row.status, assignedRole: row.assigned_role, createdAt: row.created_at, updatedAt: row.updated_at,
  }));
}
