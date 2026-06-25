// Pass 3 unit (1) — upstream #96 memory isolation + recall mode + #107
// migrateDbFile. Verifies: agents recall their own memories plus the explicit
// shared tier; the recall-mode toggle is read from settings; setMemoryShared
// flips visibility; migrateDbFile upgrades an arbitrary db file idempotently.

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  _initTestDatabase,
  saveStructuredMemory,
  getRecentHighImportanceMemories,
  setMemoryShared,
  getMemoryRecallMode,
  setMemoryRecallMode,
  migrateDbFile,
} from '../db.js';

const CHAT = 'chat-1';
beforeEach(() => { _initTestDatabase(); });

function mem(agentId: string, summary: string) {
  return saveStructuredMemory(CHAT, summary, summary, [], [], 0.9, 'conversation', agentId);
}

describe('#96 memory isolation + shared tier', () => {
  it('an agent recalls its OWN memories but not another private agent memory', () => {
    mem('duke-due-diligence', 'duke private fact');
    mem('acquisition-copilot', 'ace private fact');
    const dukeRecall = getRecentHighImportanceMemories(CHAT, 10, 'duke-due-diligence').map((m) => m.summary);
    expect(dukeRecall).toContain('duke private fact');
    expect(dukeRecall).not.toContain('ace private fact');
  });

  it('a shared (shared = 1) memory is recalled by ANY agent', () => {
    const id = mem('acquisition-copilot', 'shared market note');
    setMemoryShared(id, true);
    const dukeRecall = getRecentHighImportanceMemories(CHAT, 10, 'duke-due-diligence').map((m) => m.summary);
    expect(dukeRecall).toContain('shared market note');
  });

  it('setMemoryShared(false) re-privatizes a memory', () => {
    const id = mem('acquisition-copilot', 'temporarily shared');
    setMemoryShared(id, true);
    setMemoryShared(id, false);
    const dukeRecall = getRecentHighImportanceMemories(CHAT, 10, 'duke-due-diligence').map((m) => m.summary);
    expect(dukeRecall).not.toContain('temporarily shared');
  });

  it('no agentId scope returns all memories (legacy/shared path)', () => {
    mem('duke-due-diligence', 'd');
    mem('acquisition-copilot', 'a');
    expect(getRecentHighImportanceMemories(CHAT, 10).length).toBe(2);
  });
});

describe('memory recall mode', () => {
  it('defaults to isolated and is togglable via settings', () => {
    expect(getMemoryRecallMode()).toBe('isolated');
    setMemoryRecallMode('shared');
    expect(getMemoryRecallMode()).toBe('shared');
    setMemoryRecallMode('isolated');
    expect(getMemoryRecallMode()).toBe('isolated');
  });
});

describe('#107 migrateDbFile', () => {
  it('upgrades an arbitrary db file in place, idempotently, with a shared column', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'landos-migrate-'));
    const p = path.join(dir, 'snap.db');
    expect(() => migrateDbFile(p)).not.toThrow();
    expect(() => migrateDbFile(p)).not.toThrow(); // idempotent
    // The migrated file has the #96 shared column on memories.
    const Database = (await importBetterSqlite()).default;
    const d = new Database(p);
    const cols = d.prepare(`PRAGMA table_info(memories)`).all() as Array<{ name: string }>;
    d.close();
    expect(cols.some((c) => c.name === 'shared')).toBe(true);
  });
});

async function importBetterSqlite() {
  return import('better-sqlite3');
}
