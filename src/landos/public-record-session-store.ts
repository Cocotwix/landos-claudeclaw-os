// LandOS — authenticated public-record SESSION metadata.
//
// Logging in again for every parcel is slow and looks like abuse to the portal,
// so an authenticated session is worth keeping. What is NOT worth keeping in
// SQLite is the thing that makes the session work: the cookie or token itself.
//
// So this table stores lifecycle metadata plus a vault HANDLE. The authenticated
// material lives in the same DPAPI vault as the password and is retrieved only
// at the moment it is presented back to the portal that issued it.
//
// The scope key is carried on every row and re-checked on every read. A session
// established against one vendor or one county can never be handed to another,
// which is the same rule the credential registry enforces — stated twice on
// purpose, because a leaked cookie is as bad as a leaked password.

import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import { getLandosDb } from './db.js';
import {
  accountScopeKey,
  candidateScopeKeys,
  credentialAppliesTo,
  isAccountScope,
  normalizeAccessTarget,
  type AccessTarget,
  type AccountScope,
} from './public-record-access-types.js';

export const PUBLIC_RECORD_SESSION_STATES = ['authenticated', 'expired', 'none'] as const;
export type PublicRecordSessionState = (typeof PUBLIC_RECORD_SESSION_STATES)[number];

export interface PublicRecordSession {
  sessionId: string;
  accountId: string;
  providerFamily: string;
  deploymentDomain: string;
  accountScope: AccountScope;
  scopeKey: string;
  state: PublicRecordSessionState;
  establishedAt: string;
  lastVerifiedAt: string | null;
  /** Advisory only. An expiry the portal never stated is left null, not guessed. */
  expiresAt: string | null;
  /** Vault handle for the authenticated material. Never the material itself. */
  stateHandle: string | null;
}

/** The narrow slice of the credential vault a session needs. */
export interface SessionMaterialVault {
  isAvailable(): Promise<boolean>;
  put(input: { scope: string; password: string; kind?: 'password' | 'session_cookie' | 'token' }): Promise<{ credentialHandle: string }>;
  retrieve(handle: string): Promise<{ value: string }>;
  delete?(handle: string): Promise<boolean>;
}

const SECRET_SHAPED = /(^|[^a-z])(cookie|set-cookie|session[-_]?id|bearer|authorization|jsessionid|asp\.net_sessionid|phpsessid)([^a-z]|$)|[=;]\s*[A-Za-z0-9._~+/-]{20,}/i;

/**
 * Refuses to persist anything that looks like live session material.
 *
 * Run over every string on the row before it reaches SQLite. A handle is a
 * reference; if it smells like a cookie it is not a handle.
 */
export function assertNoSessionMaterial(session: PublicRecordSession): void {
  for (const [key, value] of Object.entries(session)) {
    if (typeof value !== 'string') continue;
    if (key === 'stateHandle' && value.startsWith('landos-vault:')) continue;
    if (SECRET_SHAPED.test(value)) {
      throw new Error(`Session material cannot be persisted in field "${key}".`);
    }
  }
}

export class PublicRecordSessionStore {
  constructor(private readonly db: Database.Database = getLandosDb()) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS landos_public_record_session (
        session_id        TEXT PRIMARY KEY,
        account_id        TEXT NOT NULL,
        provider_family   TEXT NOT NULL,
        deployment_domain TEXT NOT NULL,
        account_scope     TEXT NOT NULL,
        scope_key         TEXT NOT NULL,
        state             TEXT NOT NULL,
        established_at    TEXT NOT NULL,
        last_verified_at  TEXT,
        expires_at        TEXT,
        state_handle      TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_landos_public_record_session_scope
        ON landos_public_record_session(scope_key, state);
    `);
  }

  /**
   * One live session row per (account, deployment). Replaced rather than
   * accumulated, so a re-login cannot leave a stale authenticated row that a
   * later lookup would happily return.
   */
  save(session: PublicRecordSession): PublicRecordSession {
    assertNoSessionMaterial(session);
    const replace = this.db.transaction((row: PublicRecordSession) => {
      this.db.prepare('DELETE FROM landos_public_record_session WHERE account_id = ? AND deployment_domain = ? AND session_id != ?')
        .run(row.accountId, row.deploymentDomain, row.sessionId);
      this.db.prepare(`
        INSERT INTO landos_public_record_session (
          session_id, account_id, provider_family, deployment_domain, account_scope, scope_key,
          state, established_at, last_verified_at, expires_at, state_handle
        ) VALUES (
          @sessionId, @accountId, @providerFamily, @deploymentDomain, @accountScope, @scopeKey,
          @state, @establishedAt, @lastVerifiedAt, @expiresAt, @stateHandle
        )
        ON CONFLICT(session_id) DO UPDATE SET
          state = excluded.state,
          last_verified_at = excluded.last_verified_at,
          expires_at = excluded.expires_at,
          state_handle = excluded.state_handle
      `).run(row);
    });
    replace(session);
    return this.get(session.sessionId) ?? session;
  }

  get(sessionId: string): PublicRecordSession | null {
    const row = this.db.prepare('SELECT * FROM landos_public_record_session WHERE session_id = ?').get(sessionId);
    return row ? fromRow(row as Record<string, unknown>) : null;
  }

  /**
   * The reuse path, gated exactly like a credential.
   *
   * Only a session whose own scope entitles it to this target is returned. A
   * row that merely shares a hostname string but not a provider family is not a
   * match, and never becomes one.
   */
  findFor(target: AccessTarget): PublicRecordSession | null {
    const t = normalizeAccessTarget(target);
    const statement = this.db.prepare(
      `SELECT * FROM landos_public_record_session
       WHERE scope_key = ? AND state = 'authenticated'
       ORDER BY COALESCE(last_verified_at, established_at) DESC`,
    );
    for (const { scopeKey } of candidateScopeKeys(t)) {
      const rows = statement.all(scopeKey) as unknown as Record<string, unknown>[];
      for (const row of rows) {
        const session = fromRow(row);
        if (!isAccountScope(session.accountScope)) continue;
        if (!credentialAppliesTo({ accountScope: session.accountScope, scopeKey: session.scopeKey }, t)) continue;
        // A deployment session is bound to the exact host that issued it, even
        // when the account above it is provider-wide.
        if (session.deploymentDomain && session.deploymentDomain !== t.deploymentDomain) continue;
        return session;
      }
    }
    return null;
  }

  markExpired(sessionId: string, at: string): PublicRecordSession | null {
    this.db.prepare('UPDATE landos_public_record_session SET state = ?, last_verified_at = ? WHERE session_id = ?')
      .run('expired', at, sessionId);
    return this.get(sessionId);
  }

  listForAccount(accountId: string): PublicRecordSession[] {
    return (this.db.prepare('SELECT * FROM landos_public_record_session WHERE account_id = ? ORDER BY established_at DESC')
      .all(accountId) as unknown as Record<string, unknown>[]).map(fromRow);
  }
}

/** Builds a session row for a freshly authenticated portal. */
export function newSession(input: {
  accountId: string;
  target: AccessTarget;
  accountScope: AccountScope;
  establishedAt: string;
  expiresAt?: string | null;
  stateHandle?: string | null;
}): PublicRecordSession {
  const t = normalizeAccessTarget(input.target);
  return {
    sessionId: crypto.randomUUID(),
    accountId: input.accountId,
    providerFamily: t.providerFamily,
    deploymentDomain: t.deploymentDomain,
    accountScope: input.accountScope,
    scopeKey: accountScopeKey(input.accountScope, t),
    state: 'authenticated',
    establishedAt: input.establishedAt,
    lastVerifiedAt: input.establishedAt,
    expiresAt: input.expiresAt ?? null,
    stateHandle: input.stateHandle ?? null,
  };
}

/** True when a stated expiry has passed. An unstated expiry never expires on a guess. */
export function sessionExpired(session: PublicRecordSession, now: string): boolean {
  if (session.state !== 'authenticated') return true;
  if (!session.expiresAt) return false;
  return Date.parse(session.expiresAt) <= Date.parse(now);
}

function fromRow(row: Record<string, unknown>): PublicRecordSession {
  return {
    sessionId: String(row.session_id),
    accountId: String(row.account_id),
    providerFamily: String(row.provider_family),
    deploymentDomain: String(row.deployment_domain),
    accountScope: (isAccountScope(row.account_scope) ? row.account_scope : 'deployment'),
    scopeKey: String(row.scope_key),
    state: String(row.state) as PublicRecordSessionState,
    establishedAt: String(row.established_at),
    lastVerifiedAt: nullable(row.last_verified_at),
    expiresAt: nullable(row.expires_at),
    stateHandle: nullable(row.state_handle),
  };
}

function nullable(value: unknown): string | null {
  return value === null || value === undefined || String(value) === '' ? null : String(value);
}
