// LandOS Knowledge Layer — R2 (S3-compatible) backend + config-driven selection.
//
// This makes the KnowledgeStore LIVE-READY for Cloudflare R2 without forcing the
// @aws-sdk/client-s3 dependency on the build: the SDK is loaded by a LAZY,
// VARIABLE-SPECIFIER dynamic import inside the default factory, so tsc/vitest/
// `npm run build` never need it installed. The R2 backend is only constructed
// when R2 is fully configured AND the SDK is importable; otherwise selection
// falls back to the local-fs backend with a loud, honest reason.
//
// Security posture mirrors live-data-preflight.ts:
//   - presence-only diagnostics (knowledgeStoreStatus) — secret VALUES are never
//     returned to the dashboard, only whether each key is present;
//   - secrets are read from the APPROVED config source (process.env wins, then
//     .env via readEnvFile) into a fresh in-memory object — never written back to
//     process.env, never logged;
//   - no network/credential access happens at import or during selection unless
//     R2 is the chosen backend.

import { readEnvFile } from '../env.js';
import {
  LocalFsKnowledgeStore,
  safeKey,
  type KnowledgeKey,
  type KnowledgeObject,
  type KnowledgeStore,
} from './knowledge-store.js';

type Env = Record<string, string | undefined>;

/** The env keys the R2 knowledge backend reads. Definitions only — no .env edit. */
export const R2_ENV_KEYS = {
  /** 'r2' forces R2 (loud failure if unconfigured), 'local' forces local-fs,
   *  'auto' (default/unset) selects R2 only when fully configured. */
  backend: 'LANDOS_KNOWLEDGE_BACKEND',
  accountId: 'LANDOS_R2_ACCOUNT_ID',
  accessKeyId: 'LANDOS_R2_ACCESS_KEY_ID',
  secretAccessKey: 'LANDOS_R2_SECRET_ACCESS_KEY',
  bucket: 'LANDOS_R2_BUCKET',
  /** Optional explicit endpoint; derived from accountId when unset. */
  endpoint: 'LANDOS_R2_ENDPOINT',
} as const;

/** The R2 secret keys required to actually connect (excludes the optional ones). */
const R2_REQUIRED_KEYS = [
  R2_ENV_KEYS.accountId,
  R2_ENV_KEYS.accessKeyId,
  R2_ENV_KEYS.secretAccessKey,
  R2_ENV_KEYS.bucket,
] as const;

export type KnowledgeBackendPref = 'r2' | 'local' | 'auto';

export interface ResolveKnowledgeEnvDeps {
  processEnv?: Env;
  readEnv?: (keys: string[]) => Record<string, string>;
  /** Force-skip the .env read (hermetic tests). Mirrors the LandPortal/live-data
   *  guard so a developer's real secrets can neither satisfy nor leak into a test. */
  disableDotenvFallback?: boolean;
}

/** Resolve the knowledge-layer env from the approved config source. process.env
 *  wins; otherwise the .env file via readEnvFile. Returns a fresh object and
 *  NEVER writes process.env (so secrets are not exported to spawned agents). */
export function resolveKnowledgeEnv(deps: ResolveKnowledgeEnvDeps = {}): Env {
  const keys = Object.values(R2_ENV_KEYS) as string[];
  const processEnv: Env = deps.processEnv ?? process.env;
  const disable = deps.disableDotenvFallback ?? !!processEnv.LANDOS_DISABLE_DOTENV_FALLBACK;
  const fromFile = disable ? {} : (deps.readEnv ?? readEnvFile)(keys);
  const merged: Env = { ...fromFile };
  for (const key of keys) {
    const exported = processEnv[key];
    if (typeof exported === 'string' && exported.trim().length > 0) merged[key] = exported;
  }
  return merged;
}

function present(v: string | undefined): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}

function backendPref(env: Env): KnowledgeBackendPref {
  const v = (env[R2_ENV_KEYS.backend] ?? '').trim().toLowerCase();
  return v === 'r2' || v === 'local' ? v : 'auto';
}

/** Presence-only R2 config view for diagnostics. NEVER carries secret values. */
export interface R2ConfigPresence {
  configured: boolean;
  missing: string[];
  /** Derived endpoint host (non-secret) when an account id is present. */
  endpoint: string | null;
  /** Whether an explicit bucket is configured (name is non-secret-ish but we
   *  still only report presence to keep the surface uniform). */
  hasBucket: boolean;
}

export function r2ConfigPresence(env: Env): R2ConfigPresence {
  const missing = R2_REQUIRED_KEYS.filter((k) => !present(env[k]));
  const accountId = env[R2_ENV_KEYS.accountId];
  const explicit = env[R2_ENV_KEYS.endpoint];
  const endpoint = present(explicit)
    ? (explicit as string).trim()
    : present(accountId)
      ? `https://${(accountId as string).trim()}.r2.cloudflarestorage.com`
      : null;
  return {
    configured: missing.length === 0,
    missing: [...missing],
    endpoint,
    hasBucket: present(env[R2_ENV_KEYS.bucket]),
  };
}

/** Actual R2 connection secrets. Built only inside the factory path; never
 *  returned to callers/dashboard and never logged. */
interface R2Secrets {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  endpoint: string;
}

function readR2Secrets(env: Env): R2Secrets {
  const presence = r2ConfigPresence(env);
  if (!presence.configured || !presence.endpoint) {
    throw new Error(`R2 not fully configured (missing ${presence.missing.join(', ') || 'endpoint'}).`);
  }
  return {
    accountId: (env[R2_ENV_KEYS.accountId] as string).trim(),
    accessKeyId: (env[R2_ENV_KEYS.accessKeyId] as string).trim(),
    secretAccessKey: (env[R2_ENV_KEYS.secretAccessKey] as string).trim(),
    bucket: (env[R2_ENV_KEYS.bucket] as string).trim(),
    endpoint: presence.endpoint,
  };
}

// ── R2 backend client abstraction (testable, SDK-agnostic) ────────────────────

/** The minimal object-store surface the R2 KnowledgeStore needs. The default
 *  factory adapts @aws-sdk/client-s3 to this; tests inject a fake directly. */
export interface R2BackendClient {
  putObject(key: string, body: Uint8Array): Promise<void>;
  getObject(key: string): Promise<Uint8Array | null>;
  headObject(key: string): Promise<boolean>;
  listObjects(prefix: string): Promise<KnowledgeObject[]>;
  deleteObject(key: string): Promise<boolean>;
}

export type R2ClientFactory = (secrets: R2Secrets) => Promise<R2BackendClient>;

/** Default factory: LAZILY imports @aws-sdk/client-s3 via a VARIABLE specifier so
 *  tsc/build never require it. Fails loud (never silently) when the SDK is not
 *  installed — the caller decides whether to fall back (auto) or surface (forced). */
const defaultR2ClientFactory: R2ClientFactory = async (secrets) => {
  const spec = '@aws-sdk/client-s3';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let sdk: any;
  try {
    sdk = await import(spec);
  } catch {
    throw new Error(
      `R2 backend selected but ${spec} is not installed. Install it (separate approval) or set ` +
        `${R2_ENV_KEYS.backend}=local to use the local-fs backend.`,
    );
  }
  const client = new sdk.S3Client({
    region: 'auto',
    endpoint: secrets.endpoint,
    credentials: { accessKeyId: secrets.accessKeyId, secretAccessKey: secrets.secretAccessKey },
  });
  const bucket = secrets.bucket;
  return {
    async putObject(key, body) {
      await client.send(new sdk.PutObjectCommand({ Bucket: bucket, Key: key, Body: body }));
    },
    async getObject(key) {
      try {
        const r = await client.send(new sdk.GetObjectCommand({ Bucket: bucket, Key: key }));
        if (!r.Body) return null;
        const bytes = await r.Body.transformToByteArray();
        return new Uint8Array(bytes);
      } catch (e: unknown) {
        if (isNotFound(e)) return null;
        throw e;
      }
    },
    async headObject(key) {
      try {
        await client.send(new sdk.HeadObjectCommand({ Bucket: bucket, Key: key }));
        return true;
      } catch (e: unknown) {
        if (isNotFound(e)) return false;
        throw e;
      }
    },
    async listObjects(prefix) {
      const out: KnowledgeObject[] = [];
      let token: string | undefined;
      do {
        const r = await client.send(
          new sdk.ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
        );
        for (const o of r.Contents ?? []) {
          if (!o.Key) continue;
          out.push({ key: o.Key, size: o.Size ?? 0, updatedAt: o.LastModified ? new Date(o.LastModified).getTime() : 0 });
        }
        token = r.IsTruncated ? r.NextContinuationToken : undefined;
      } while (token);
      return out;
    },
    async deleteObject(key) {
      try {
        await client.send(new sdk.DeleteObjectCommand({ Bucket: bucket, Key: key }));
        return true;
      } catch (e: unknown) {
        if (isNotFound(e)) return false;
        throw e;
      }
    },
  };
};

function isNotFound(e: unknown): boolean {
  const name = (e as { name?: string; Code?: string })?.name ?? (e as { Code?: string })?.Code;
  const status = (e as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
  return name === 'NoSuchKey' || name === 'NotFound' || status === 404;
}

/** R2 (S3-compatible) KnowledgeStore. Delegates to an already-built backend
 *  client so the same class serves live R2 and the test fake. Keys are guarded by
 *  the shared safeKey() so traversal is impossible. */
export class R2KnowledgeStore implements KnowledgeStore {
  readonly backend = 'r2';
  constructor(private client: R2BackendClient) {}
  // All methods are async so a bad key REJECTS (never throws synchronously),
  // matching LocalFsKnowledgeStore and the KnowledgeStore contract.
  async put(key: KnowledgeKey, body: string | Uint8Array): Promise<void> {
    const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
    return this.client.putObject(safeKey(key), bytes);
  }
  async get(key: KnowledgeKey): Promise<Uint8Array | null> {
    return this.client.getObject(safeKey(key));
  }
  async getText(key: KnowledgeKey): Promise<string | null> {
    const b = await this.get(key);
    return b ? new TextDecoder().decode(b) : null;
  }
  async exists(key: KnowledgeKey): Promise<boolean> {
    return this.client.headObject(safeKey(key));
  }
  async list(prefix: KnowledgeKey): Promise<KnowledgeObject[]> {
    return this.client.listObjects(safeKey(prefix));
  }
  async delete(key: KnowledgeKey): Promise<boolean> {
    return this.client.deleteObject(safeKey(key));
  }
}

// ── Selection ─────────────────────────────────────────────────────────────────

export interface KnowledgeStoreStatus {
  /** The backend that WOULD be selected for the given env (no connection made). */
  selected: 'r2' | 'local-fs';
  pref: KnowledgeBackendPref;
  r2: R2ConfigPresence;
  /** Loud, honest one-liner — names exactly why this backend was chosen. */
  reason: string;
}

/** Presence-only status for the dashboard/diagnostics. Makes NO connection and
 *  reads NO secret value — only whether each required key is present. */
export function knowledgeStoreStatus(deps: ResolveKnowledgeEnvDeps = {}): KnowledgeStoreStatus {
  const env = resolveKnowledgeEnv(deps);
  const pref = backendPref(env);
  const r2 = r2ConfigPresence(env);
  let selected: 'r2' | 'local-fs';
  let reason: string;
  if (pref === 'local') {
    selected = 'local-fs';
    reason = `${R2_ENV_KEYS.backend}=local: local-fs knowledge backend in force.`;
  } else if (pref === 'r2') {
    selected = r2.configured ? 'r2' : 'local-fs';
    reason = r2.configured
      ? `${R2_ENV_KEYS.backend}=r2: R2 backend selected (connects on first use).`
      : `${R2_ENV_KEYS.backend}=r2 but R2 is not fully configured (missing ${r2.missing.join(', ')}); will FAIL LOUD at use, not silently fall back.`;
  } else {
    selected = r2.configured ? 'r2' : 'local-fs';
    reason = r2.configured
      ? 'auto: R2 fully configured — R2 backend selected (connects on first use).'
      : `auto: R2 not configured (missing ${r2.missing.join(', ')}); local-fs backend in force (no credentials required).`;
  }
  return { selected, pref, r2, reason };
}

export interface ResolveKnowledgeStoreDeps extends ResolveKnowledgeEnvDeps {
  /** Injected in tests so no real SDK/network is touched. Default lazily imports
   *  @aws-sdk/client-s3 and builds a live R2 client. */
  r2ClientFactory?: R2ClientFactory;
  /** Base dir for the local-fs fallback (tests point this at a tmp dir). */
  localBaseDir?: string;
}

export interface ResolveKnowledgeStoreResult {
  store: KnowledgeStore;
  backend: 'r2' | 'local-fs';
  reason: string;
}

/**
 * Live-ready knowledge-store selection.
 *   - pref 'local', or auto with no R2 config  -> local-fs (no credentials).
 *   - pref 'r2' / auto with full R2 config      -> build R2 via the factory.
 * When the R2 build fails (e.g. SDK not installed): a FORCED 'r2' pref rethrows
 * loud; 'auto' falls back to local-fs with the failure reason recorded. No
 * connection or secret read happens unless R2 is actually chosen.
 */
export async function resolveKnowledgeStore(
  deps: ResolveKnowledgeStoreDeps = {},
): Promise<ResolveKnowledgeStoreResult> {
  const env = resolveKnowledgeEnv(deps);
  const status = knowledgeStoreStatus(deps);
  const local = () => new LocalFsKnowledgeStore(deps.localBaseDir ? { baseDir: deps.localBaseDir } : {});

  if (status.selected === 'local-fs') {
    return { store: local(), backend: 'local-fs', reason: status.reason };
  }

  // R2 selected — attempt to build it.
  const factory = deps.r2ClientFactory ?? defaultR2ClientFactory;
  try {
    const client = await factory(readR2Secrets(env));
    return { store: new R2KnowledgeStore(client), backend: 'r2', reason: status.reason };
  } catch (e: unknown) {
    const msg = (e as Error)?.message ?? String(e);
    if (status.pref === 'r2') {
      // Forced R2: never silently downgrade — surface loudly.
      throw new Error(`R2 knowledge backend was forced (${R2_ENV_KEYS.backend}=r2) but could not be built: ${msg}`);
    }
    return {
      store: local(),
      backend: 'local-fs',
      reason: `auto: R2 configured but could not be built (${msg}); local-fs backend in force.`,
    };
  }
}
