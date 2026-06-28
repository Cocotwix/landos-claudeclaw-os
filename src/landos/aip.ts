// LandOS — Acquisition Intelligence Platform (AIP) v1.
//
// The permanent LEARNING engine behind the Acquisitions department. NOT a CRM,
// NOT GHL, NOT messaging, NOT a chatbot. It converts curated acquisition
// knowledge into structured, cited, APPROVED intelligence that generates the
// playbook and powers coaching lookups. Modular + model-agnostic + replaceable:
// ingestion sources plug into one contract; nothing here depends on a single
// model, and NOTHING ever becomes active or modifies the playbook without
// Tyler's explicit approval. Raw media lives in R2 (never Git) — assets store an
// r2 key + metadata only.

import { getLandosDb, landosAudit } from './db.js';

// ── Source + category + status vocabularies ─────────────────────────────────
export const AIP_SOURCE_TYPES = [
  'mp3', 'mp4', 'wav', 'youtube', 'pdf', 'book', 'sop', 'transcript', 'discovery_call',
  'offer_call', 'meeting', 'objection_library', 'negotiation_example', 'seller_conversation',
  'note', 'markdown', 'text', 'other',
] as const;
export type AipSourceType = (typeof AIP_SOURCE_TYPES)[number];

export const AIP_KNOWLEDGE_CATEGORIES = [
  'conversation_principle', 'negotiation_technique', 'discovery_question', 'motivation_indicator',
  'objection_category', 'closing_pattern', 'communication_style', 'psychology', 'mistake',
  'success_pattern', 'failure_pattern', 'follow_up_timing', 'offer_framing', 'language_preference',
  'do_not_say', 'risk_signal', 'decision_maker_signal',
] as const;
export type AipKnowledgeCategory = (typeof AIP_KNOWLEDGE_CATEGORIES)[number];

export type AipKnowledgeStatus = 'proposed' | 'approved' | 'rejected';
export const AIP_PLAYBOOK_SECTIONS = [
  'philosophy', 'tone', 'conversation_rules', 'rapport', 'discovery', 'negotiation',
  'offer_presentation', 'follow_up', 'objection_handling', 'psychology', 'closing', 'do_not_say', 'examples',
] as const;
export type AipPlaybookSection = (typeof AIP_PLAYBOOK_SECTIONS)[number];
export type AipPlaybookStatus = 'proposed' | 'published' | 'superseded';

export const isSourceType = (v: unknown): v is AipSourceType => typeof v === 'string' && (AIP_SOURCE_TYPES as readonly string[]).includes(v);
export const isKnowledgeCategory = (v: unknown): v is AipKnowledgeCategory => typeof v === 'string' && (AIP_KNOWLEDGE_CATEGORIES as readonly string[]).includes(v);
export const isPlaybookSection = (v: unknown): v is AipPlaybookSection => typeof v === 'string' && (AIP_PLAYBOOK_SECTIONS as readonly string[]).includes(v);

// ── R2 storage contract (raw media never in Git) ────────────────────────────
export const AIP_R2_ROOT = 'agents/acquisitions/training';
export const AIP_R2_PATHS = {
  raw: `${AIP_R2_ROOT}/raw/`,
  transcripts: `${AIP_R2_ROOT}/transcripts/`,
  summaries: `${AIP_R2_ROOT}/summaries/`,
  extracted: `${AIP_R2_ROOT}/extracted/`,
  embeddings: `${AIP_R2_ROOT}/embeddings/`,
  playbook: `${AIP_R2_ROOT}/playbook/`,
  coaching: `${AIP_R2_ROOT}/coaching/`,
  examples: `${AIP_R2_ROOT}/examples/`,
} as const;
/** Deterministic R2 key for a raw asset. The file itself NEVER enters Git. */
export function aipRawKey(sourceType: AipSourceType, id: number, ext = ''): string {
  return `${AIP_R2_PATHS.raw}${sourceType}/${id}${ext ? `.${ext.replace(/^\./, '')}` : ''}`;
}

// ── Ingestion contract (modular plug point; one contract per source) ────────
export interface AssetMetadata {
  uploadDate?: string; tags?: string[]; durationSec?: number; pages?: number; url?: string;
  confidence?: 'high' | 'medium' | 'low'; notes?: string; [k: string]: unknown;
}
export interface TrainingAsset {
  id: number; sourceType: AipSourceType; title: string; author: string;
  r2Key: string; metadata: AssetMetadata;
  transcriptStatus: 'pending' | 'placeholder' | 'transcribed' | 'manual' | 'unsupported';
  extractionStatus: 'pending' | 'extracted' | 'none';
  createdAt: number; updatedAt: number;
}
/** A source handler plugs into this one contract. v1 ships the contract + a
 *  registry; real transcription/parsing pipelines are future and report
 *  'unsupported' until implemented (never fabricated). */
export interface IngestionHandler {
  sourceType: AipSourceType;
  implemented: boolean;
  /** Prepare/transcribe the asset. v1 default: not implemented -> manual/unsupported. */
  prepare(asset: TrainingAsset): Promise<{ transcriptStatus: TrainingAsset['transcriptStatus']; note: string }>;
}
const DEFAULT_HANDLER = (sourceType: AipSourceType): IngestionHandler => ({
  sourceType, implemented: false,
  async prepare() {
    // Text-like sources accept a manually-pasted transcript today; media needs a future pipeline.
    const textLike = ['transcript', 'note', 'markdown', 'text', 'sop'].includes(sourceType);
    return { transcriptStatus: textLike ? 'manual' : 'unsupported', note: textLike ? 'Accepts a manually-provided transcript.' : `No ${sourceType} ingestion pipeline yet (future).` };
  },
});
const HANDLERS = new Map<AipSourceType, IngestionHandler>();
/** Register a real ingestion handler for a source type (replaceable; model-agnostic). */
export function registerIngestionHandler(h: IngestionHandler): void { HANDLERS.set(h.sourceType, h); }
export function getIngestionHandler(sourceType: AipSourceType): IngestionHandler { return HANDLERS.get(sourceType) ?? DEFAULT_HANDLER(sourceType); }

// ── Citations + knowledge graph links ───────────────────────────────────────
export interface Citation { assetId?: number; sourceTitle: string; locator?: string; quote?: string }
export interface KnowledgeLink { type: 'knowledge' | 'asset'; refId: number; relation: string }
export interface KnowledgeItem {
  id: number; category: AipKnowledgeCategory; content: string;
  citations: Citation[]; links: KnowledgeLink[];
  confidence: 'high' | 'medium' | 'low'; status: AipKnowledgeStatus; version: number;
  sourceAssetId: number | null; createdAt: number; updatedAt: number;
}
export interface PlaybookSectionRecord {
  id: number; section: AipPlaybookSection; content: string;
  knowledgeRefs: number[]; status: AipPlaybookStatus; version: number; createdAt: number;
}

const parse = <T>(s: string, f: T): T => { try { return (JSON.parse(s) ?? f) as T; } catch { return f; } };

// ── Asset registry ──────────────────────────────────────────────────────────
function assetRow(r: Record<string, unknown>): TrainingAsset {
  return {
    id: r.id as number, sourceType: (r.source_type as AipSourceType), title: r.title as string, author: r.author as string,
    r2Key: r.r2_key as string, metadata: parse<AssetMetadata>(r.metadata_json as string, {}),
    transcriptStatus: r.transcript_status as TrainingAsset['transcriptStatus'],
    extractionStatus: r.extraction_status as TrainingAsset['extractionStatus'],
    createdAt: r.created_at as number, updatedAt: r.updated_at as number,
  };
}
export function registerAsset(input: { sourceType: AipSourceType; title: string; author?: string; metadata?: AssetMetadata; ext?: string }): TrainingAsset {
  const db = getLandosDb();
  const id = db.prepare(`INSERT INTO landos_aip_asset (source_type, title, author, metadata_json, transcript_status, extraction_status) VALUES (?, ?, ?, ?, 'pending', 'pending')`)
    .run(input.sourceType, input.title, input.author ?? '', JSON.stringify(input.metadata ?? {})).lastInsertRowid as number;
  const r2Key = aipRawKey(input.sourceType, id, input.ext);
  db.prepare(`UPDATE landos_aip_asset SET r2_key = ? WHERE id = ?`).run(r2Key, id);
  landosAudit('tyler', 'aip_asset_registered', `${input.sourceType}: ${input.title}`, { refTable: 'landos_aip_asset', refId: id });
  return getAsset(id)!;
}
export function getAsset(id: number): TrainingAsset | undefined {
  const r = getLandosDb().prepare('SELECT * FROM landos_aip_asset WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return r ? assetRow(r) : undefined;
}
export function listAssets(): TrainingAsset[] {
  return (getLandosDb().prepare('SELECT * FROM landos_aip_asset ORDER BY id DESC').all() as Array<Record<string, unknown>>).map(assetRow);
}
/** Attach a (placeholder or real) transcript status — text stored in R2/extracted, not Git. */
export function setTranscriptStatus(id: number, status: TrainingAsset['transcriptStatus']): TrainingAsset | undefined {
  getLandosDb().prepare(`UPDATE landos_aip_asset SET transcript_status = ?, updated_at = strftime('%s','now') WHERE id = ?`).run(status, id);
  return getAsset(id);
}
export function setExtractionStatus(id: number, status: TrainingAsset['extractionStatus']): TrainingAsset | undefined {
  getLandosDb().prepare(`UPDATE landos_aip_asset SET extraction_status = ?, updated_at = strftime('%s','now') WHERE id = ?`).run(status, id);
  return getAsset(id);
}

// ── Knowledge store (with citations + graph links + approval + versioning) ──
function knowledgeRow(r: Record<string, unknown>): KnowledgeItem {
  return {
    id: r.id as number, category: r.category as AipKnowledgeCategory, content: r.content as string,
    citations: parse<Citation[]>(r.citations_json as string, []), links: parse<KnowledgeLink[]>(r.links_json as string, []),
    confidence: r.confidence as KnowledgeItem['confidence'], status: r.status as AipKnowledgeStatus, version: r.version as number,
    sourceAssetId: (r.source_asset_id as number | null) ?? null, createdAt: r.created_at as number, updatedAt: r.updated_at as number,
  };
}
/** Add an EXTRACTED knowledge item. Always starts 'proposed' — never active until approved. */
export function addKnowledge(input: { category: AipKnowledgeCategory; content: string; citations?: Citation[]; links?: KnowledgeLink[]; confidence?: 'high' | 'medium' | 'low'; sourceAssetId?: number | null }): KnowledgeItem {
  const id = getLandosDb().prepare(
    `INSERT INTO landos_aip_knowledge (category, content, citations_json, links_json, confidence, status, version, source_asset_id) VALUES (?, ?, ?, ?, ?, 'proposed', 1, ?)`,
  ).run(input.category, input.content, JSON.stringify(input.citations ?? []), JSON.stringify(input.links ?? []), input.confidence ?? 'medium', input.sourceAssetId ?? null).lastInsertRowid as number;
  landosAudit('tyler', 'aip_knowledge_proposed', `${input.category}`, { refTable: 'landos_aip_knowledge', refId: id });
  return getKnowledge(id)!;
}
export function getKnowledge(id: number): KnowledgeItem | undefined {
  const r = getLandosDb().prepare('SELECT * FROM landos_aip_knowledge WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return r ? knowledgeRow(r) : undefined;
}
export function listKnowledge(filter: { category?: AipKnowledgeCategory; status?: AipKnowledgeStatus } = {}): KnowledgeItem[] {
  const where: string[] = []; const args: unknown[] = [];
  if (filter.category) { where.push('category = ?'); args.push(filter.category); }
  if (filter.status) { where.push('status = ?'); args.push(filter.status); }
  const clause = where.length ? `WHERE ${where.join(' AND ')} ` : '';
  return (getLandosDb().prepare(`SELECT * FROM landos_aip_knowledge ${clause}ORDER BY id DESC`).all(...args) as Array<Record<string, unknown>>).map(knowledgeRow);
}
/** Approval workflow: approve (version bump) or reject. Nothing becomes active otherwise. */
export function approveKnowledge(id: number): KnowledgeItem | undefined {
  getLandosDb().prepare(`UPDATE landos_aip_knowledge SET status = 'approved', version = version + 1, updated_at = strftime('%s','now') WHERE id = ?`).run(id);
  landosAudit('tyler', 'aip_knowledge_approved', `knowledge ${id}`, { refTable: 'landos_aip_knowledge', refId: id });
  return getKnowledge(id);
}
export function rejectKnowledge(id: number): KnowledgeItem | undefined {
  getLandosDb().prepare(`UPDATE landos_aip_knowledge SET status = 'rejected', updated_at = strftime('%s','now') WHERE id = ?`).run(id);
  return getKnowledge(id);
}
/** Knowledge graph: resolve the items/assets a knowledge item references. */
export function knowledgeGraph(id: number): { item: KnowledgeItem | undefined; linkedKnowledge: KnowledgeItem[]; citedAssets: TrainingAsset[] } {
  const item = getKnowledge(id);
  const linkedKnowledge = (item?.links ?? []).filter((l) => l.type === 'knowledge').map((l) => getKnowledge(l.refId)).filter((x): x is KnowledgeItem => !!x);
  const citedAssets = (item?.citations ?? []).map((c) => c.assetId).filter((x): x is number => typeof x === 'number').map((aid) => getAsset(aid)).filter((x): x is TrainingAsset => !!x);
  return { item, linkedKnowledge, citedAssets };
}

// ── Playbook generator (from APPROVED knowledge; never auto-publishes) ───────
const SECTION_CATEGORIES: Record<AipPlaybookSection, AipKnowledgeCategory[]> = {
  philosophy: ['conversation_principle', 'success_pattern', 'failure_pattern'],
  tone: ['communication_style', 'language_preference'],
  conversation_rules: ['conversation_principle', 'do_not_say', 'language_preference'],
  rapport: ['psychology', 'communication_style'],
  discovery: ['discovery_question', 'motivation_indicator', 'decision_maker_signal'],
  negotiation: ['negotiation_technique', 'psychology'],
  offer_presentation: ['offer_framing', 'closing_pattern'],
  follow_up: ['follow_up_timing'],
  objection_handling: ['objection_category'],
  psychology: ['psychology', 'motivation_indicator', 'risk_signal'],
  closing: ['closing_pattern', 'success_pattern'],
  do_not_say: ['do_not_say', 'mistake'],
  examples: ['success_pattern', 'failure_pattern', 'negotiation_technique'],
};
export interface PlaybookGenerationResult { section: AipPlaybookSection; record: PlaybookSectionRecord; sourcedFrom: number; note: string }
/** Generate a playbook section FROM APPROVED knowledge only. Produces a 'proposed'
 *  record (NEVER auto-published). Deterministic composition; cites the knowledge. */
export function generatePlaybookSection(section: AipPlaybookSection): PlaybookGenerationResult {
  const cats = SECTION_CATEGORIES[section];
  const approved = listKnowledge({ status: 'approved' }).filter((k) => cats.includes(k.category));
  const lines = approved.map((k) => `- (${k.category}) ${k.content}${k.citations[0]?.sourceTitle ? ` [src: ${k.citations[0].sourceTitle}]` : ''}`);
  const content = lines.length
    ? `# ${section.replace(/_/g, ' ')}\n\n${lines.join('\n')}`
    : `# ${section.replace(/_/g, ' ')}\n\n(No approved knowledge for this section yet — foundational only.)`;
  const refs = approved.map((k) => k.id);
  const id = getLandosDb().prepare(`INSERT INTO landos_aip_playbook (section, content, knowledge_refs_json, status, version) VALUES (?, ?, ?, 'proposed', 1)`)
    .run(section, content, JSON.stringify(refs)).lastInsertRowid as number;
  landosAudit('tyler', 'aip_playbook_proposed', `${section} (from ${refs.length} approved)`, { refTable: 'landos_aip_playbook', refId: id });
  return { section, record: getPlaybookRecord(id)!, sourcedFrom: approved.length, note: approved.length ? `Generated from ${approved.length} approved knowledge item(s) — proposed, awaiting approval.` : 'No approved knowledge yet; proposed placeholder.' };
}
function playbookRow(r: Record<string, unknown>): PlaybookSectionRecord {
  return { id: r.id as number, section: r.section as AipPlaybookSection, content: r.content as string, knowledgeRefs: parse<number[]>(r.knowledge_refs_json as string, []), status: r.status as AipPlaybookStatus, version: r.version as number, createdAt: r.created_at as number };
}
export function getPlaybookRecord(id: number): PlaybookSectionRecord | undefined {
  const r = getLandosDb().prepare('SELECT * FROM landos_aip_playbook WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return r ? playbookRow(r) : undefined;
}
/** Publish a proposed section: supersedes the prior published version, bumps version. */
export function publishPlaybookSection(id: number): PlaybookSectionRecord | undefined {
  const db = getLandosDb();
  const rec = getPlaybookRecord(id); if (!rec) return undefined;
  const prior = db.prepare(`SELECT MAX(version) v FROM landos_aip_playbook WHERE section = ? AND status = 'published'`).get(rec.section) as { v: number | null };
  const nextVersion = (prior.v ?? 0) + 1;
  db.prepare(`UPDATE landos_aip_playbook SET status = 'superseded' WHERE section = ? AND status = 'published'`).run(rec.section);
  db.prepare(`UPDATE landos_aip_playbook SET status = 'published', version = ? WHERE id = ?`).run(nextVersion, id);
  landosAudit('tyler', 'aip_playbook_published', `${rec.section} v${nextVersion}`, { refTable: 'landos_aip_playbook', refId: id });
  return getPlaybookRecord(id);
}
export function getPublishedPlaybookSection(section: AipPlaybookSection): PlaybookSectionRecord | undefined {
  const r = getLandosDb().prepare(`SELECT * FROM landos_aip_playbook WHERE section = ? AND status = 'published' ORDER BY version DESC LIMIT 1`).get(section) as Record<string, unknown> | undefined;
  return r ? playbookRow(r) : undefined;
}
export function listPlaybook(section?: AipPlaybookSection): PlaybookSectionRecord[] {
  const rows = section
    ? getLandosDb().prepare('SELECT * FROM landos_aip_playbook WHERE section = ? ORDER BY id DESC').all(section)
    : getLandosDb().prepare('SELECT * FROM landos_aip_playbook ORDER BY id DESC').all();
  return (rows as Array<Record<string, unknown>>).map(playbookRow);
}

// ── Coaching engine (cites the knowledge base; APPROVED only) ───────────────
export type CoachingMode = 'before_call' | 'during_prep' | 'after_call_review' | 'negotiation_review' | 'offer_review';
export interface CoachingResult { mode: CoachingMode; query: string; insights: KnowledgeItem[]; citations: Citation[]; note: string }
const MODE_CATEGORIES: Record<CoachingMode, AipKnowledgeCategory[]> = {
  before_call: ['discovery_question', 'motivation_indicator', 'conversation_principle', 'do_not_say'],
  during_prep: ['discovery_question', 'psychology', 'risk_signal', 'decision_maker_signal'],
  after_call_review: ['mistake', 'success_pattern', 'failure_pattern'],
  negotiation_review: ['negotiation_technique', 'objection_category', 'psychology'],
  offer_review: ['offer_framing', 'closing_pattern'],
};
/** Coaching lookup over APPROVED knowledge only (never proposed/rejected). Keyword
 *  match + mode-relevant categories. Every result carries its citations. */
export function coachingLookup(input: { mode: CoachingMode; query?: string; limit?: number }): CoachingResult {
  const approved = listKnowledge({ status: 'approved' });
  const cats = new Set(MODE_CATEGORIES[input.mode]);
  const q = (input.query ?? '').toLowerCase().split(/\W+/).filter((w) => w.length > 3);
  const scored = approved
    .map((k) => {
      let score = cats.has(k.category) ? 2 : 0;
      for (const w of q) if (k.content.toLowerCase().includes(w)) score += 1;
      return { k, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, input.limit ?? 8)
    .map((x) => x.k);
  const citations = scored.flatMap((k) => k.citations);
  return {
    mode: input.mode, query: input.query ?? '',
    insights: scored, citations,
    note: scored.length ? `${scored.length} approved insight(s) for ${input.mode}, all cited.` : `No approved knowledge matches yet for ${input.mode} — ingest + approve training to grow coaching.`,
  };
}

// ── Analytics contracts (shapes only — not implemented in v1) ───────────────
export interface AipAnalytics {
  commonObjections: Array<{ objection: string; count: number }>;
  topSuccessPatterns: string[]; commonFailureReasons: string[];
  sellerMotivationTrends: Array<{ motivation: string; count: number }>;
  followUpEffectiveness: number | null; offerAcceptanceTrend: number | null;
  playbookEvolution: Array<{ section: string; versions: number }>;
  implemented: false;
}
