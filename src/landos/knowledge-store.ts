// LandOS Knowledge Layer — R2 KnowledgeStore scaffold.
//
// The knowledge layer holds BUSINESS ARTIFACTS + agent knowledge/memory, separate
// from SQLite (operational state) and the GitHub repo (code only). In production
// this is Cloudflare R2 (S3-compatible) accessed from Node via @aws-sdk/client-s3;
// here we ship the INTERFACE plus a local-filesystem implementation so the whole
// system is wired and testable WITHOUT R2 credentials. Swapping in the R2 impl is
// a one-class change behind this interface — no agent/workflow change.
//
// No secrets, no network, no credentials are required by this module.

import fs from 'fs';
import path from 'path';

/** A namespaced object key in the knowledge layer (forward-slash paths). */
export type KnowledgeKey = string;

export interface KnowledgeObject {
  key: KnowledgeKey;
  size: number;
  updatedAt: number;
}

export interface KnowledgeStore {
  /** Backend label for diagnostics (e.g. 'local-fs', 'r2'). Never a secret. */
  readonly backend: string;
  put(key: KnowledgeKey, body: string | Uint8Array): Promise<void>;
  get(key: KnowledgeKey): Promise<Uint8Array | null>;
  getText(key: KnowledgeKey): Promise<string | null>;
  exists(key: KnowledgeKey): Promise<boolean>;
  list(prefix: KnowledgeKey): Promise<KnowledgeObject[]>;
  delete(key: KnowledgeKey): Promise<boolean>;
}

// ── R2 path conventions (single source of truth for knowledge-layer keys) ─────
export const R2_PATHS = {
  agentKnowledge: (agentKey: string) => `agents/${agentKey}/knowledge`,
  agentMemory: (agentKey: string) => `agents/${agentKey}/memory`,
  report: (apn: string) => `reports/${apn}`,
  lead: (apn: string) => `leads/${apn}`,
  deal: (apn: string) => `deals/${apn}`,
  underwriting: (apn: string) => `underwriting/${apn}`,
  calls: (apn: string) => `calls/${apn}`,
  countyScorecard: () => 'markets/county_scorecard.json',
  strategyLibrary: () => 'research/strategy_library.md',
  playbook: (name: string) => `playbook/${name}`,
  training: (sub: string) => `training/${sub}`,
  intelligence: (name: string) => `intelligence/${name}`,
  system: (name: string) => `system/${name}`,
} as const;

export function safeKey(key: KnowledgeKey): string {
  // Forbid path traversal; keys are forward-slash, repo-relative-free.
  const norm = key.replace(/\\/g, '/').replace(/^\/+/, '');
  if (norm.split('/').some((seg) => seg === '..')) throw new Error(`unsafe knowledge key: ${key}`);
  return norm;
}

/**
 * Local-filesystem KnowledgeStore. Roots under a base dir (default: the gitignored
 * store/landos-knowledge). This is the dev/offline implementation; the R2 impl
 * (same interface) lands once credentials exist. Pure I/O, no network, no secrets.
 */
export class LocalFsKnowledgeStore implements KnowledgeStore {
  readonly backend = 'local-fs';
  private baseDir: string;
  constructor(opts: { baseDir?: string } = {}) {
    this.baseDir = opts.baseDir ?? path.join(process.cwd(), 'store', 'landos-knowledge');
  }
  private abs(key: KnowledgeKey): string {
    return path.join(this.baseDir, safeKey(key));
  }
  async put(key: KnowledgeKey, body: string | Uint8Array): Promise<void> {
    const p = this.abs(key);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, typeof body === 'string' ? Buffer.from(body, 'utf-8') : Buffer.from(body));
  }
  async get(key: KnowledgeKey): Promise<Uint8Array | null> {
    try { return new Uint8Array(fs.readFileSync(this.abs(key))); } catch { return null; }
  }
  async getText(key: KnowledgeKey): Promise<string | null> {
    const b = await this.get(key);
    return b ? Buffer.from(b).toString('utf-8') : null;
  }
  async exists(key: KnowledgeKey): Promise<boolean> {
    return fs.existsSync(this.abs(key));
  }
  async list(prefix: KnowledgeKey): Promise<KnowledgeObject[]> {
    const root = this.abs(prefix);
    const out: KnowledgeObject[] = [];
    const walk = (dir: string) => {
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else {
          const st = fs.statSync(full);
          out.push({ key: path.relative(this.baseDir, full).replace(/\\/g, '/'), size: st.size, updatedAt: Math.floor(st.mtimeMs) });
        }
      }
    };
    walk(root);
    return out;
  }
  async delete(key: KnowledgeKey): Promise<boolean> {
    try { fs.unlinkSync(this.abs(key)); return true; } catch { return false; }
  }
}

/** Default store used by LandOS today (local-fs). The R2 impl will be selected
 *  here by config once credentials exist; callers depend only on KnowledgeStore. */
export function defaultKnowledgeStore(): KnowledgeStore {
  return new LocalFsKnowledgeStore();
}
