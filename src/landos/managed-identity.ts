/** Managed LandOS service identity metadata. No email address, credential, or
 * verification message is persisted unless an approved adapter supplies it at
 * execution time; SQLite retains aliases/references only. */
import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import { getLandosDb } from './db.js';
import type { ManagedEmailIdentity, ManagedEmailIdentityProvider } from './government-account-manager.js';

export const MANAGED_IDENTITY_STATUSES = ['blocked', 'configured', 'verified', 'retired'] as const;
export type ManagedIdentityStatus = (typeof MANAGED_IDENTITY_STATUSES)[number];

export interface ManagedLandosIdentity {
  identityId: string;
  displayName: string;
  organizationName: string;
  accountPurpose: string;
  managedEmailAliasReference: string | null;
  recoveryEmailReference: string | null;
  managedPhoneReference: string | null;
  mailingAddressReference: string | null;
  credentialVaultKey: string | null;
  status: ManagedIdentityStatus;
  verificationCapabilities: string[];
  createdAt: string;
  lastVerifiedAt: string | null;
  allowedAccountCategories: string[];
  prohibitedAccountCategories: string[];
}

export interface ManagedIdentityAudit { identityId: string; at: string; action: string; detail: string; }

export class ManagedIdentityRepository {
  constructor(private readonly db: Database.Database = getLandosDb(), private readonly now: () => string = () => new Date().toISOString()) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS landos_managed_identity (
        identity_id TEXT PRIMARY KEY, display_name TEXT NOT NULL, organization_name TEXT NOT NULL,
        account_purpose TEXT NOT NULL, managed_email_alias_reference TEXT, recovery_email_reference TEXT,
        managed_phone_reference TEXT, mailing_address_reference TEXT, credential_vault_key TEXT,
        status TEXT NOT NULL, verification_capabilities_json TEXT NOT NULL, created_at TEXT NOT NULL,
        last_verified_at TEXT, allowed_categories_json TEXT NOT NULL, prohibited_categories_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS landos_managed_identity_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT, identity_id TEXT NOT NULL, at TEXT NOT NULL,
        action TEXT NOT NULL, detail TEXT NOT NULL
      );
    `);
  }

  ensureDefault(): ManagedLandosIdentity {
    const existing = this.get('landos-public-research');
    if (existing) return existing;
    const now = this.now();
    const identity: ManagedLandosIdentity = {
      identityId: 'landos-public-research', displayName: 'LandOS Public Records Research', organizationName: 'LandOS',
      accountPurpose: 'Truthful access to eligible free public property and government records.',
      managedEmailAliasReference: null, recoveryEmailReference: null, managedPhoneReference: null, mailingAddressReference: null,
      credentialVaultKey: null, status: 'blocked', verificationCapabilities: [], createdAt: now, lastVerifiedAt: null,
      allowedAccountCategories: ['official government property records', 'government-contracted public records'],
      prohibitedAccountCategories: ['paid services', 'licensed/professional access', 'identity-verified access', 'property-owner access'],
    };
    this.save(identity, 'identity_initialized', 'No managed mailbox adapter has been approved.');
    return identity;
  }

  get(identityId: string): ManagedLandosIdentity | null {
    const row = this.db.prepare('SELECT * FROM landos_managed_identity WHERE identity_id = ?').get(identityId) as Record<string, unknown> | undefined;
    return row ? fromRow(row) : null;
  }
  listAudit(identityId: string): ManagedIdentityAudit[] {
    return (this.db.prepare('SELECT identity_id, at, action, detail FROM landos_managed_identity_audit WHERE identity_id = ? ORDER BY id DESC').all(identityId) as Record<string, unknown>[])
      .map((row) => ({ identityId: String(row.identity_id), at: String(row.at), action: String(row.action), detail: String(row.detail) }));
  }
  save(identity: ManagedLandosIdentity, action = 'identity_updated', detail = 'Safe identity metadata updated.'): ManagedLandosIdentity {
    assertSafe(identity);
    this.db.prepare(`INSERT INTO landos_managed_identity (
      identity_id,display_name,organization_name,account_purpose,managed_email_alias_reference,recovery_email_reference,
      managed_phone_reference,mailing_address_reference,credential_vault_key,status,verification_capabilities_json,created_at,
      last_verified_at,allowed_categories_json,prohibited_categories_json
    ) VALUES (@identityId,@displayName,@organizationName,@accountPurpose,@managedEmailAliasReference,@recoveryEmailReference,
      @managedPhoneReference,@mailingAddressReference,@credentialVaultKey,@status,@verificationCapabilities,@createdAt,
      @lastVerifiedAt,@allowedAccountCategories,@prohibitedAccountCategories)
    ON CONFLICT(identity_id) DO UPDATE SET display_name=excluded.display_name, organization_name=excluded.organization_name,
      account_purpose=excluded.account_purpose, managed_email_alias_reference=excluded.managed_email_alias_reference,
      recovery_email_reference=excluded.recovery_email_reference, managed_phone_reference=excluded.managed_phone_reference,
      mailing_address_reference=excluded.mailing_address_reference, credential_vault_key=excluded.credential_vault_key,
      status=excluded.status, verification_capabilities_json=excluded.verification_capabilities_json,
      last_verified_at=excluded.last_verified_at, allowed_categories_json=excluded.allowed_categories_json,
      prohibited_categories_json=excluded.prohibited_categories_json`).run({
      ...identity, verificationCapabilities: JSON.stringify(identity.verificationCapabilities),
      allowedAccountCategories: JSON.stringify(identity.allowedAccountCategories), prohibitedAccountCategories: JSON.stringify(identity.prohibitedAccountCategories),
    });
    this.db.prepare('INSERT INTO landos_managed_identity_audit (identity_id,at,action,detail) VALUES (?,?,?,?)')
      .run(identity.identityId, this.now(), action, safeDetail(detail));
    return this.get(identity.identityId)!;
  }
}

/** Narrow env-backed adapter. It returns null unless all three values establish a
 * real, configured, receivable managed mailbox. Values are never returned by the
 * Research Access UI and are never stored in the identity repository. */
export class EnvironmentManagedEmailProvider implements ManagedEmailIdentityProvider {
  constructor(private readonly env: Record<string, string | undefined> = process.env) {}
  async resolve(): Promise<ManagedEmailIdentity | null> {
    const address = String(this.env.LANDOS_MANAGED_EMAIL ?? '').trim();
    const aliasReference = String(this.env.LANDOS_MANAGED_EMAIL_ALIAS_REFERENCE ?? '').trim();
    const verified = /^(1|true|yes)$/i.test(String(this.env.LANDOS_MANAGED_EMAIL_VERIFIED ?? ''));
    if (!address || !aliasReference || !verified || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) || /example\./i.test(address)) return null;
    return { address, aliasReference, receivable: true, control: 'verified' };
  }
}

export function managedIdentityStatus(repository = new ManagedIdentityRepository(), emailProvider: ManagedEmailIdentityProvider = new EnvironmentManagedEmailProvider()): Promise<{ identity: ManagedLandosIdentity; managedEmail: { available: boolean; reason: string } }> {
  const identity = repository.ensureDefault();
  return emailProvider.resolve({ siteDomain: 'public-records', governmentJurisdiction: 'LandOS' }).then((email) => ({
    identity,
    managedEmail: email ? { available: true, reason: 'Approved managed email adapter available.' } : { available: false, reason: 'Managed email identity unavailable.' },
  }));
}

function fromRow(row: Record<string, unknown>): ManagedLandosIdentity {
  const json = <T>(value: unknown, fallback: T): T => { try { return JSON.parse(String(value ?? '')) as T; } catch { return fallback; } };
  return { identityId: String(row.identity_id), displayName: String(row.display_name), organizationName: String(row.organization_name), accountPurpose: String(row.account_purpose), managedEmailAliasReference: nullable(row.managed_email_alias_reference), recoveryEmailReference: nullable(row.recovery_email_reference), managedPhoneReference: nullable(row.managed_phone_reference), mailingAddressReference: nullable(row.mailing_address_reference), credentialVaultKey: nullable(row.credential_vault_key), status: row.status as ManagedIdentityStatus, verificationCapabilities: json(row.verification_capabilities_json, []), createdAt: String(row.created_at), lastVerifiedAt: nullable(row.last_verified_at), allowedAccountCategories: json(row.allowed_categories_json, []), prohibitedAccountCategories: json(row.prohibited_categories_json, []) };
}
function nullable(value: unknown): string | null { return value == null || String(value).trim() === '' ? null : String(value); }
function safeDetail(value: string): string { return String(value).replace(/password|token|secret|cookie|verification\s*(code|link)/ig, '[redacted]').slice(0, 500); }
function assertSafe(identity: ManagedLandosIdentity): void {
  if (!identity.identityId || !identity.displayName || !identity.organizationName || !identity.accountPurpose) throw new Error('Managed identity requires an ID, display name, organization, and purpose.');
  if (!MANAGED_IDENTITY_STATUSES.includes(identity.status)) throw new Error('Invalid managed identity status.');
  const serialized = JSON.stringify(identity);
  if (/password\s*[:=]|bearer\s+|access.?token|refresh.?token|cookie\s*[:=]|verification\s*(code|link)/i.test(serialized)) throw new Error('Managed identity metadata cannot contain a secret or verification challenge.');
}
