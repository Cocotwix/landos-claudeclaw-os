// LandOS Agent Training / Knowledge Ingestion shell.
//
// The deterministic intake path for an agent's knowledge layer. It takes a
// training document (a doc, note, transcript, pasted URL text, or raw playbook
// material), content-addresses it, and persists it under the agent's R2
// knowledge root with full provenance in a manifest. It is the shell only:
//
//   - DETERMINISTIC: sha256 content-addressing + a JSON manifest. NO model call,
//     NO embedding, NO external fetch, NO network. Real embedding/indexing/
//     fine-tuning is a deferred pass that reads this manifest.
//   - GOVERNED: only a KNOWN roster agent can be ingested into. Raw training is
//     stored with status 'raw_training' and promoted=false. It NEVER auto-promotes
//     into an agent instruction — mirroring the playbook lifecycle in db.ts
//     (raw_training -> ... -> agent_instruction_update is approval-gated).
//   - BACKEND-AGNOSTIC: works against any KnowledgeStore (local-fs today, R2 once
//     credentials exist), so ingestion is live-ready without code change.

import { createHash } from 'crypto';

import { getAgentDef } from './agent-roster.js';
import { R2_PATHS, type KnowledgeStore } from './knowledge-store.js';

/** The kinds of raw training material the shell accepts. All are stored as
 *  raw_training; none is treated as a vetted instruction. */
export const TRAINING_SOURCE_TYPES = [
  'doc',
  'note',
  'transcript',
  'url_text',
  'playbook_raw',
  'reference',
] as const;
export type TrainingSourceType = (typeof TRAINING_SOURCE_TYPES)[number];

export interface TrainingDocument {
  /** Stable roster agent key, e.g. 'market_bot' (validated against AGENT_ROSTER). */
  agentKey: string;
  title: string;
  /** Human/source provenance: where this material came from (file name, URL,
   *  "Tyler note", etc.). Recorded, never used to fabricate authority. */
  source: string;
  sourceType: TrainingSourceType;
  content: string;
  /** Stored file extension (default 'md'). */
  ext?: string;
}

/** One manifest row. Promotion to an agent instruction is out of scope here and
 *  always starts false (approval-gated elsewhere). */
export interface KnowledgeManifestItem {
  id: string;            // short sha256
  key: string;           // full storage key in the knowledge layer
  title: string;
  source: string;
  sourceType: TrainingSourceType;
  bytes: number;
  sha256: string;
  status: 'raw_training';
  promoted: false;
  ingestedAt: string;
}

export interface KnowledgeManifest {
  version: 1;
  agentKey: string;
  items: KnowledgeManifestItem[];
  updatedAt: string;
}

export interface IngestResult {
  item: KnowledgeManifestItem;
  /** True when an identical-content item already existed (idempotent no-op). */
  deduped: boolean;
}

export interface IngestionDeps {
  store: KnowledgeStore;
  nowIso?: string;
}

function manifestKey(agentKey: string): string {
  return `${R2_PATHS.agentKnowledge(agentKey)}/_manifest.json`;
}

function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf-8').digest('hex');
}

export async function loadManifest(agentKey: string, store: KnowledgeStore): Promise<KnowledgeManifest> {
  const txt = await store.getText(manifestKey(agentKey));
  if (!txt) return { version: 1, agentKey, items: [], updatedAt: new Date(0).toISOString() };
  try {
    const m = JSON.parse(txt) as KnowledgeManifest;
    // Defensive: keep the manifest agentKey authoritative.
    return { version: 1, agentKey, items: Array.isArray(m.items) ? m.items : [], updatedAt: m.updatedAt };
  } catch {
    return { version: 1, agentKey, items: [], updatedAt: new Date(0).toISOString() };
  }
}

/**
 * Ingest one training document into the agent's knowledge layer. Deterministic
 * and idempotent: the same content yields the same id and a second ingest is a
 * dedup no-op. Validates the agent against the roster, stores the body under the
 * agent's training prefix, and records provenance in the manifest as raw_training
 * (never auto-promoted). Makes no model call, no network call, no external fetch.
 */
export async function ingestTrainingDoc(doc: TrainingDocument, deps: IngestionDeps): Promise<IngestResult> {
  const agent = getAgentDef(doc.agentKey);
  if (!agent) {
    throw new Error(`unknown agent "${doc.agentKey}": ingestion is restricted to known roster agents.`);
  }
  if (!TRAINING_SOURCE_TYPES.includes(doc.sourceType)) {
    throw new Error(`unsupported training sourceType "${doc.sourceType}".`);
  }
  if (typeof doc.content !== 'string' || doc.content.length === 0) {
    throw new Error('training document content is empty; nothing ingested.');
  }

  const now = deps.nowIso ?? new Date().toISOString();
  // Content-address over the body AND its provenance/type so the same bytes from
  // two different sources remain distinct manifest rows.
  const sha = sha256Hex(`${doc.sourceType}\n${doc.source}\n${doc.content}`);
  const id = sha.slice(0, 16);
  const ext = (doc.ext ?? 'md').replace(/[^a-z0-9]/gi, '') || 'md';
  const key = `${R2_PATHS.agentKnowledge(doc.agentKey)}/training/${id}.${ext}`;

  const manifest = await loadManifest(doc.agentKey, deps.store);
  const existing = manifest.items.find((it) => it.id === id);
  if (existing) {
    return { item: existing, deduped: true };
  }

  await deps.store.put(key, doc.content);
  const item: KnowledgeManifestItem = {
    id,
    key,
    title: doc.title,
    source: doc.source,
    sourceType: doc.sourceType,
    bytes: Buffer.byteLength(doc.content, 'utf-8'),
    sha256: sha,
    status: 'raw_training',
    promoted: false,
    ingestedAt: now,
  };
  manifest.items.push(item);
  manifest.updatedAt = now;
  await deps.store.put(manifestKey(doc.agentKey), JSON.stringify(manifest, null, 2));
  return { item, deduped: false };
}

/** Read-only list of an agent's ingested knowledge for the dashboard. */
export async function listAgentKnowledge(agentKey: string, store: KnowledgeStore): Promise<KnowledgeManifestItem[]> {
  return (await loadManifest(agentKey, store)).items;
}

/**
 * Promotion guard. Raw training NEVER auto-promotes into an agent instruction;
 * that transition is approval-gated through the playbook lifecycle (db.ts).
 * This shell can never flip an item to promoted, so it always returns false —
 * the param is part of the contract for the future gated promotion path.
 */
export function canPromoteToInstruction(_item: KnowledgeManifestItem, _approved: boolean): boolean {
  return false;
}
