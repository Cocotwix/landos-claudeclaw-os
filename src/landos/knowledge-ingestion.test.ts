import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { LocalFsKnowledgeStore } from './knowledge-store.js';
import {
  ingestTrainingDoc,
  loadManifest,
  listAgentKnowledge,
  canPromoteToInstruction,
  type TrainingDocument,
} from './knowledge-ingestion.js';

function tmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'landos-ingest-'));
  return new LocalFsKnowledgeStore({ baseDir: dir });
}

const doc = (over: Partial<TrainingDocument> = {}): TrainingDocument => ({
  agentKey: 'market_bot',
  title: 'County metric framework notes',
  source: 'Tyler note',
  sourceType: 'note',
  content: 'Population density target is 50-150 per sq mi.',
  ...over,
});

describe('knowledge ingestion shell', () => {
  it('ingests a doc into the agent knowledge layer with raw_training provenance', async () => {
    const store = tmpStore();
    const r = await ingestTrainingDoc(doc(), { store, nowIso: '2026-06-25T00:00:00Z' });
    expect(r.deduped).toBe(false);
    expect(r.item.status).toBe('raw_training');
    expect(r.item.promoted).toBe(false);
    expect(r.item.key).toMatch(/^agents\/market_bot\/knowledge\/training\/.+\.md$/);
    // body persisted, manifest records it
    expect(await store.getText(r.item.key)).toContain('Population density');
    const items = await listAgentKnowledge('market_bot', store);
    expect(items.map((i) => i.id)).toContain(r.item.id);
  });

  it('is deterministic + idempotent: same content dedups (no second write)', async () => {
    const store = tmpStore();
    const a = await ingestTrainingDoc(doc(), { store });
    const b = await ingestTrainingDoc(doc(), { store });
    expect(b.deduped).toBe(true);
    expect(b.item.id).toBe(a.item.id);
    expect((await listAgentKnowledge('market_bot', store)).length).toBe(1);
  });

  it('distinguishes identical bytes from different sources', async () => {
    const store = tmpStore();
    const a = await ingestTrainingDoc(doc({ source: 'src-A' }), { store });
    const b = await ingestTrainingDoc(doc({ source: 'src-B' }), { store });
    expect(a.item.id).not.toBe(b.item.id);
    expect((await listAgentKnowledge('market_bot', store)).length).toBe(2);
  });

  it('refuses an unknown agent (governed to the roster)', async () => {
    const store = tmpStore();
    await expect(ingestTrainingDoc(doc({ agentKey: 'nope_bot' }), { store })).rejects.toThrow(/unknown agent/i);
  });

  it('refuses empty content and an unsupported source type', async () => {
    const store = tmpStore();
    await expect(ingestTrainingDoc(doc({ content: '' }), { store })).rejects.toThrow(/empty/i);
    // @ts-expect-error intentionally invalid sourceType
    await expect(ingestTrainingDoc(doc({ sourceType: 'malware' }), { store })).rejects.toThrow(/unsupported/i);
  });

  it('never auto-promotes raw training to an instruction', () => {
    const item = { id: 'x', key: 'k', title: 't', source: 's', sourceType: 'note', bytes: 1, sha256: 'h', status: 'raw_training', promoted: false, ingestedAt: 'now' } as const;
    expect(canPromoteToInstruction(item, true)).toBe(false);
    expect(canPromoteToInstruction(item, false)).toBe(false);
  });

  it('loadManifest returns an empty manifest for a fresh agent', async () => {
    const store = tmpStore();
    const m = await loadManifest('dd_bot', store);
    expect(m.agentKey).toBe('dd_bot');
    expect(m.items).toEqual([]);
  });
});
