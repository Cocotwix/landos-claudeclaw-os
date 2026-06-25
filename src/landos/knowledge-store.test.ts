import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { LocalFsKnowledgeStore, R2_PATHS, defaultKnowledgeStore } from './knowledge-store.js';

function tmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'landos-kb-'));
  return new LocalFsKnowledgeStore({ baseDir: dir });
}

describe('LocalFsKnowledgeStore', () => {
  it('put/get/getText round-trips and reports backend', async () => {
    const s = tmpStore();
    expect(s.backend).toBe('local-fs');
    await s.put('agents/dd_bot/knowledge/note.md', 'hello');
    expect(await s.getText('agents/dd_bot/knowledge/note.md')).toBe('hello');
    expect(await s.exists('agents/dd_bot/knowledge/note.md')).toBe(true);
    expect(await s.getText('missing/key')).toBeNull();
  });

  it('list returns objects under a prefix; delete removes', async () => {
    const s = tmpStore();
    await s.put('reports/APN-1/r.md', 'a');
    await s.put('reports/APN-1/r.pdf', 'b');
    const objs = await s.list('reports/APN-1');
    expect(objs.length).toBe(2);
    expect(await s.delete('reports/APN-1/r.md')).toBe(true);
    expect((await s.list('reports/APN-1')).length).toBe(1);
  });

  it('rejects path traversal keys', async () => {
    const s = tmpStore();
    await expect(s.put('../escape.txt', 'x')).rejects.toThrow(/unsafe/);
  });

  it('R2 path conventions match the architecture doc', () => {
    expect(R2_PATHS.agentKnowledge('dd_bot')).toBe('agents/dd_bot/knowledge');
    expect(R2_PATHS.report('APN-1')).toBe('reports/APN-1');
    expect(R2_PATHS.underwriting('APN-1')).toBe('underwriting/APN-1');
    expect(R2_PATHS.countyScorecard()).toBe('markets/county_scorecard.json');
  });

  it('defaultKnowledgeStore is the local-fs backend (no credentials required)', () => {
    expect(defaultKnowledgeStore().backend).toBe('local-fs');
  });
});
