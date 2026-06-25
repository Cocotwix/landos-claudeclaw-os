import { describe, it, expect } from 'vitest';
import {
  R2_ENV_KEYS,
  r2ConfigPresence,
  resolveKnowledgeEnv,
  knowledgeStoreStatus,
  resolveKnowledgeStore,
  R2KnowledgeStore,
  type R2BackendClient,
  type R2ClientFactory,
} from './knowledge-store-r2.js';
import type { KnowledgeObject } from './knowledge-store.js';

const FULL_R2 = {
  [R2_ENV_KEYS.accountId]: 'acct123',
  [R2_ENV_KEYS.accessKeyId]: 'ak',
  [R2_ENV_KEYS.secretAccessKey]: 'sk',
  [R2_ENV_KEYS.bucket]: 'landos-knowledge',
};

// Hermetic env: never read a developer's real .env during these tests.
const hermetic = (processEnv: Record<string, string | undefined>) => ({
  processEnv,
  disableDotenvFallback: true,
});

/** In-memory R2 backend fake — proves the store logic with no SDK/network. */
function fakeBackend(): { client: R2BackendClient; map: Map<string, Uint8Array> } {
  const map = new Map<string, Uint8Array>();
  const client: R2BackendClient = {
    async putObject(key, body) { map.set(key, body); },
    async getObject(key) { return map.get(key) ?? null; },
    async headObject(key) { return map.has(key); },
    async listObjects(prefix) {
      const out: KnowledgeObject[] = [];
      for (const [key, v] of map) if (key.startsWith(prefix)) out.push({ key, size: v.length, updatedAt: 1 });
      return out;
    },
    async deleteObject(key) { return map.delete(key); },
  };
  return { client, map };
}

describe('R2 config presence (presence-only, no secret values)', () => {
  it('reports configured + derived endpoint when all required keys present', () => {
    const p = r2ConfigPresence(FULL_R2);
    expect(p.configured).toBe(true);
    expect(p.missing).toEqual([]);
    expect(p.endpoint).toBe('https://acct123.r2.cloudflarestorage.com');
    expect(p.hasBucket).toBe(true);
  });

  it('lists exactly the missing required keys when unconfigured', () => {
    const p = r2ConfigPresence({ [R2_ENV_KEYS.accountId]: 'acct123' });
    expect(p.configured).toBe(false);
    expect(p.missing).toContain(R2_ENV_KEYS.accessKeyId);
    expect(p.missing).toContain(R2_ENV_KEYS.secretAccessKey);
    expect(p.missing).toContain(R2_ENV_KEYS.bucket);
    expect(p.missing).not.toContain(R2_ENV_KEYS.accountId);
  });

  it('honors an explicit endpoint over the derived one', () => {
    const p = r2ConfigPresence({ ...FULL_R2, [R2_ENV_KEYS.endpoint]: 'https://custom.example.com' });
    expect(p.endpoint).toBe('https://custom.example.com');
  });
});

describe('resolveKnowledgeEnv', () => {
  it('does not mutate process.env and prefers processEnv over file', () => {
    const before = process.env[R2_ENV_KEYS.bucket];
    const env = resolveKnowledgeEnv(hermetic({ [R2_ENV_KEYS.bucket]: 'b1' }));
    expect(env[R2_ENV_KEYS.bucket]).toBe('b1');
    expect(process.env[R2_ENV_KEYS.bucket]).toBe(before); // unchanged
  });
});

describe('knowledgeStoreStatus (no connection, no secret read)', () => {
  it('auto + no config -> local-fs, honest reason', () => {
    const s = knowledgeStoreStatus(hermetic({}));
    expect(s.selected).toBe('local-fs');
    expect(s.pref).toBe('auto');
    expect(s.reason).toMatch(/local-fs backend in force/i);
  });

  it('auto + full config -> r2 selected', () => {
    const s = knowledgeStoreStatus(hermetic({ ...FULL_R2 }));
    expect(s.selected).toBe('r2');
    expect(s.reason).toMatch(/R2 backend selected/i);
  });

  it('forced local overrides full config', () => {
    const s = knowledgeStoreStatus(hermetic({ ...FULL_R2, [R2_ENV_KEYS.backend]: 'local' }));
    expect(s.selected).toBe('local-fs');
  });

  it('forced r2 without config warns it will fail loud (not silent fallback)', () => {
    const s = knowledgeStoreStatus(hermetic({ [R2_ENV_KEYS.backend]: 'r2' }));
    expect(s.pref).toBe('r2');
    expect(s.reason).toMatch(/FAIL LOUD/i);
  });
});

describe('resolveKnowledgeStore (selection + fallback)', () => {
  it('auto with no config returns the local-fs store (no factory called)', async () => {
    let called = false;
    const factory: R2ClientFactory = async () => { called = true; return fakeBackend().client; };
    const r = await resolveKnowledgeStore({ ...hermetic({}), r2ClientFactory: factory });
    expect(r.backend).toBe('local-fs');
    expect(called).toBe(false);
  });

  it('auto with full config builds R2 via the injected factory', async () => {
    const { client } = fakeBackend();
    const r = await resolveKnowledgeStore({ ...hermetic({ ...FULL_R2 }), r2ClientFactory: async () => client });
    expect(r.backend).toBe('r2');
    expect(r.store).toBeInstanceOf(R2KnowledgeStore);
  });

  it('auto: R2 build failure falls back to local-fs with the failure reason', async () => {
    const r = await resolveKnowledgeStore({
      ...hermetic({ ...FULL_R2 }),
      r2ClientFactory: async () => { throw new Error('SDK not installed'); },
    });
    expect(r.backend).toBe('local-fs');
    expect(r.reason).toMatch(/could not be built.*SDK not installed/i);
  });

  it('forced r2: build failure throws loud (never silent downgrade)', async () => {
    await expect(
      resolveKnowledgeStore({
        ...hermetic({ ...FULL_R2, [R2_ENV_KEYS.backend]: 'r2' }),
        r2ClientFactory: async () => { throw new Error('SDK not installed'); },
      }),
    ).rejects.toThrow(/was forced.*could not be built/i);
  });
});

describe('R2KnowledgeStore (delegates to backend; guards keys)', () => {
  it('put/get/getText/exists/list/delete round-trip against the fake backend', async () => {
    const { client } = fakeBackend();
    const store = new R2KnowledgeStore(client);
    expect(store.backend).toBe('r2');
    await store.put('agents/dd_bot/knowledge/n.md', 'hello');
    expect(await store.getText('agents/dd_bot/knowledge/n.md')).toBe('hello');
    expect(await store.exists('agents/dd_bot/knowledge/n.md')).toBe(true);
    expect(await store.getText('missing/key')).toBeNull();
    await store.put('reports/APN-1/r.pdf', new Uint8Array([1, 2, 3]));
    expect((await store.list('reports/APN-1')).length).toBe(1);
    expect(await store.delete('reports/APN-1/r.pdf')).toBe(true);
    expect((await store.list('reports/APN-1')).length).toBe(0);
  });

  it('rejects path-traversal keys before touching the backend', async () => {
    const { client, map } = fakeBackend();
    const store = new R2KnowledgeStore(client);
    await expect(store.put('../escape.txt', 'x')).rejects.toThrow(/unsafe/);
    expect(map.size).toBe(0);
  });
});
