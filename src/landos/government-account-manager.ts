/**
 * Durable Government and Public Records Account Manager.
 *
 * This module deliberately separates safe account metadata from secret material.
 * Passwords exist only long enough to be handed to an approved credential vault
 * and the registration adapter. SQLite never receives a password, verification
 * code/link, cookie, bearer token, or authenticated browser state.
 */

import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import { getLandosDb } from './db.js';

export const MANAGED_EMAIL_UNAVAILABLE_REASON = 'Managed email identity unavailable.';
export const CREDENTIAL_STORAGE_UNAVAILABLE_REASON = 'Approved credential storage unavailable.';

export const GOVERNMENT_ACCOUNT_STATUSES = [
  'not_registered',
  'registration_pending',
  'verification_pending',
  'active',
  'session_expired',
  'recovery_required',
  'human_action_required',
  'blocked',
  'suspended',
  'retired',
] as const;
export type GovernmentAccountStatus = (typeof GOVERNMENT_ACCOUNT_STATUSES)[number];

export type EmailVerificationStatus =
  | 'not_required'
  | 'pending'
  | 'verified'
  | 'mailbox_unavailable'
  | 'failed';
export type AccountRecoveryStatus = 'not_needed' | 'available' | 'pending' | 'human_action_required' | 'failed';
export type SafeSessionState = 'none' | 'authenticated' | 'expired' | 'unknown';

export interface ManagedGovernmentAccount {
  accountId: string;
  siteDomain: string;
  governmentJurisdiction: string;
  platform: string;
  purpose: string;
  username: string;
  emailAliasReference: string;
  credentialHandle: string;
  accountStatus: GovernmentAccountStatus;
  emailVerificationStatus: EmailVerificationStatus;
  createdAt: string;
  lastSuccessfulLogin: string | null;
  lastPasswordRotation: string | null;
  recoveryStatus: AccountRecoveryStatus;
  termsVersion: string | null;
  registrationDate: string | null;
  failureReason: string | null;
  sessionState: SafeSessionState;
  humanActionRequired: boolean;
  humanActionReason: string | null;
  updatedAt: string;
}

export interface AccountLookup {
  siteDomain: string;
  governmentJurisdiction: string;
  platform: string;
}

export interface GovernmentAccountRepository {
  find(input: AccountLookup): ManagedGovernmentAccount | null;
  get(accountId: string): ManagedGovernmentAccount | null;
  save(account: ManagedGovernmentAccount): ManagedGovernmentAccount;
  list(): ManagedGovernmentAccount[];
}

export class SqliteGovernmentAccountRepository implements GovernmentAccountRepository {
  constructor(private readonly db: Database.Database = getLandosDb()) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS landos_government_account (
        account_id                 TEXT PRIMARY KEY,
        site_domain               TEXT NOT NULL,
        government_jurisdiction   TEXT NOT NULL,
        platform                  TEXT NOT NULL,
        purpose                   TEXT NOT NULL,
        username                  TEXT NOT NULL DEFAULT '',
        email_alias_reference     TEXT NOT NULL DEFAULT '',
        credential_handle         TEXT NOT NULL DEFAULT '',
        account_status            TEXT NOT NULL,
        email_verification_status TEXT NOT NULL,
        created_at                TEXT NOT NULL,
        last_successful_login     TEXT,
        last_password_rotation    TEXT,
        recovery_status           TEXT NOT NULL,
        terms_version             TEXT,
        registration_date         TEXT,
        failure_reason            TEXT,
        session_state             TEXT NOT NULL,
        human_action_required     INTEGER NOT NULL DEFAULT 0,
        human_action_reason       TEXT,
        updated_at                TEXT NOT NULL,
        UNIQUE(site_domain, government_jurisdiction, platform)
      );
      CREATE INDEX IF NOT EXISTS idx_landos_government_account_status
        ON landos_government_account(account_status, updated_at DESC);
    `);
  }

  find(input: AccountLookup): ManagedGovernmentAccount | null {
    const row = this.db.prepare(
      `SELECT * FROM landos_government_account
       WHERE site_domain = ? AND government_jurisdiction = ? AND platform = ?`,
    ).get(normalizeDomain(input.siteDomain), clean(input.governmentJurisdiction), clean(input.platform));
    return row ? accountFromRow(row as Record<string, unknown>) : null;
  }

  get(accountId: string): ManagedGovernmentAccount | null {
    const row = this.db.prepare('SELECT * FROM landos_government_account WHERE account_id = ?').get(accountId);
    return row ? accountFromRow(row as Record<string, unknown>) : null;
  }

  save(account: ManagedGovernmentAccount): ManagedGovernmentAccount {
    assertSafeAccountMetadata(account);
    const normalized = normalizeAccount(account);
    this.db.prepare(`
      INSERT INTO landos_government_account (
        account_id, site_domain, government_jurisdiction, platform, purpose, username,
        email_alias_reference, credential_handle, account_status, email_verification_status,
        created_at, last_successful_login, last_password_rotation, recovery_status,
        terms_version, registration_date, failure_reason, session_state,
        human_action_required, human_action_reason, updated_at
      ) VALUES (
        @accountId, @siteDomain, @governmentJurisdiction, @platform, @purpose, @username,
        @emailAliasReference, @credentialHandle, @accountStatus, @emailVerificationStatus,
        @createdAt, @lastSuccessfulLogin, @lastPasswordRotation, @recoveryStatus,
        @termsVersion, @registrationDate, @failureReason, @sessionState,
        @humanActionRequired, @humanActionReason, @updatedAt
      )
      ON CONFLICT(account_id) DO UPDATE SET
        site_domain = excluded.site_domain,
        government_jurisdiction = excluded.government_jurisdiction,
        platform = excluded.platform,
        purpose = excluded.purpose,
        username = excluded.username,
        email_alias_reference = excluded.email_alias_reference,
        credential_handle = excluded.credential_handle,
        account_status = excluded.account_status,
        email_verification_status = excluded.email_verification_status,
        last_successful_login = excluded.last_successful_login,
        last_password_rotation = excluded.last_password_rotation,
        recovery_status = excluded.recovery_status,
        terms_version = excluded.terms_version,
        registration_date = excluded.registration_date,
        failure_reason = excluded.failure_reason,
        session_state = excluded.session_state,
        human_action_required = excluded.human_action_required,
        human_action_reason = excluded.human_action_reason,
        updated_at = excluded.updated_at
    `).run({ ...normalized, humanActionRequired: normalized.humanActionRequired ? 1 : 0 });
    return this.get(normalized.accountId)!;
  }

  list(): ManagedGovernmentAccount[] {
    const rows = this.db.prepare('SELECT * FROM landos_government_account ORDER BY updated_at DESC, account_id').all() as unknown as Record<string, unknown>[];
    return rows.map(accountFromRow);
  }
}

export type RegistrationSiteKind = 'official_government' | 'government_authorized_public_records' | 'other';
export type RegistrationTerms = 'none' | 'ordinary_technical' | 'material' | 'unknown';

export interface RegistrationInspection {
  siteKind: RegistrationSiteKind;
  publicPropertyInformationPurpose: boolean;
  free: boolean;
  paymentMethodRequested: boolean;
  sensitiveIdentityVerificationRequired: boolean;
  captchaRequired: boolean;
  phoneVerificationRequired: boolean;
  approvedCompanyPhoneAvailable: boolean;
  terms: RegistrationTerms;
  prohibitsIntendedAutomation: boolean;
  truthfulMandatoryFieldsAvailable: boolean;
  termsVersion?: string | null;
}

export type RegistrationPolicyCode =
  | 'auto_registration_allowed'
  | 'ineligible_site'
  | 'non_public_information_purpose'
  | 'paid_access_required'
  | 'sensitive_identity_verification_required'
  | 'captcha_human_action_required'
  | 'phone_verification_unavailable'
  | 'material_legal_terms_review_required'
  | 'automation_prohibited'
  | 'truthful_required_field_unavailable'
  | 'managed_email_identity_unavailable'
  | 'credential_storage_unavailable';

export interface RegistrationPolicyDecision {
  allowed: boolean;
  code: RegistrationPolicyCode;
  reason: string;
  humanActionRequired: boolean;
}

export function evaluateAutomaticRegistrationPolicy(input: RegistrationInspection & {
  managedEmailIdentityAvailable: boolean;
  credentialStorageAvailable: boolean;
}): RegistrationPolicyDecision {
  if (input.siteKind === 'other') return blocked('ineligible_site', 'The site is not an official government or government-authorized public-record platform.');
  if (!input.publicPropertyInformationPurpose) return blocked('non_public_information_purpose', 'The requested account is not limited to public property or governmental information.');
  if (!input.free || input.paymentMethodRequested) return blocked('paid_access_required', 'Paid access or billing information is required.');
  if (input.sensitiveIdentityVerificationRequired) return blocked('sensitive_identity_verification_required', 'Personal identity verification is required.');
  if (input.captchaRequired) return blocked('captcha_human_action_required', 'Human CAPTCHA completion is required.', true);
  if (input.phoneVerificationRequired && !input.approvedCompanyPhoneAvailable) return blocked('phone_verification_unavailable', 'Phone verification is required and no approved company-controlled number is available.', true);
  if (input.terms === 'material' || input.terms === 'unknown') return blocked('material_legal_terms_review_required', 'Registration terms require human legal review.', true);
  if (input.prohibitsIntendedAutomation) return blocked('automation_prohibited', 'The site prohibits the intended automated use.');
  if (!input.truthfulMandatoryFieldsAvailable) return blocked('truthful_required_field_unavailable', 'A mandatory registration field cannot be completed truthfully.', true);
  if (!input.managedEmailIdentityAvailable) return blocked('managed_email_identity_unavailable', MANAGED_EMAIL_UNAVAILABLE_REASON, true);
  if (!input.credentialStorageAvailable) return blocked('credential_storage_unavailable', CREDENTIAL_STORAGE_UNAVAILABLE_REASON, true);
  return { allowed: true, code: 'auto_registration_allowed', reason: 'Eligible free public-record account; automatic registration is allowed.', humanActionRequired: false };
}

function blocked(code: Exclude<RegistrationPolicyCode, 'auto_registration_allowed'>, reason: string, humanActionRequired = false): RegistrationPolicyDecision {
  return { allowed: false, code, reason, humanActionRequired };
}

/** A receivable, organization-controlled address. The address is transient and is never persisted here. */
export interface ManagedEmailIdentity {
  address: string;
  aliasReference: string;
  receivable: boolean;
  control: 'verified' | 'unverified';
}

export interface ManagedEmailIdentityProvider {
  resolve(input: { siteDomain: string; governmentJurisdiction: string }): Promise<ManagedEmailIdentity | null>;
}

export interface CredentialVault {
  isAvailable(): Promise<boolean>;
  store(input: { scope: string; username: string; password: string }): Promise<{ credentialHandle: string }>;
  rotate?(input: { credentialHandle: string; password: string }): Promise<void>;
}

export type TransientVerificationChallenge =
  | { kind: 'link'; value: string }
  | { kind: 'code'; value: string };

export interface VerificationMailbox {
  isAvailable(): Promise<boolean>;
  retrieve(input: {
    aliasReference: string;
    expectedSenderDomain: string;
    requestedAfter: string;
    timeoutMs: number;
  }): Promise<TransientVerificationChallenge | null>;
}

export interface GovernmentRegistrationAdapter {
  inspect(): Promise<RegistrationInspection>;
  register(input: {
    username: string;
    emailAddress: string;
    password: string;
  }): Promise<
    | { status: 'active'; registeredAt?: string; sessionState?: SafeSessionState }
    | { status: 'verification_required'; expectedSenderDomain: string; registeredAt?: string }
    | { status: 'human_action_required'; reason: string }
    | { status: 'failed'; reason: string }
  >;
  verify(input: { challenge: TransientVerificationChallenge }): Promise<
    | { status: 'active'; sessionState?: SafeSessionState }
    | { status: 'human_action_required'; reason: string }
    | { status: 'failed'; reason: string }
  >;
}

export interface EnsureGovernmentAccessRequest extends AccountLookup {
  purpose: string;
  registrar: GovernmentRegistrationAdapter;
  verificationTimeoutMs?: number;
  /** Explicit operator/orchestrator retry after a pending or blocked state changes. */
  retryExistingAccess?: boolean;
}

export interface EnsureGovernmentAccessResult {
  outcome: 'reused' | 'created' | 'pending' | 'verification_pending' | 'human_action_required' | 'blocked' | 'failed';
  account: ManagedGovernmentAccount;
  policy: RegistrationPolicyDecision | null;
}

export class GovernmentAccountManager {
  constructor(
    private readonly repository: GovernmentAccountRepository,
    private readonly emailIdentities: ManagedEmailIdentityProvider,
    private readonly vault: CredentialVault,
    private readonly mailbox?: VerificationMailbox,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async ensureAccess(request: EnsureGovernmentAccessRequest): Promise<EnsureGovernmentAccessResult> {
    const lookup = normalizeLookup(request);
    const existing = this.repository.find(lookup);
    if (existing?.accountStatus === 'active') {
      return { outcome: 'reused', account: existing, policy: null };
    }
    // Refreshes and duplicate jobs must not repeat registration or verification
    // side effects. A retry is explicit after the blocking capability changes.
    if (existing && !request.retryExistingAccess && existing.accountStatus !== 'not_registered') {
      const outcome: EnsureGovernmentAccessResult['outcome'] =
        existing.accountStatus === 'verification_pending' ? 'verification_pending'
          : existing.accountStatus === 'registration_pending' ? 'pending'
            : existing.humanActionRequired ? 'human_action_required' : 'blocked';
      return { outcome, account: existing, policy: null };
    }

    const inspection = await request.registrar.inspect();
    const [emailIdentity, credentialStorageAvailable] = await Promise.all([
      this.emailIdentities.resolve({ siteDomain: lookup.siteDomain, governmentJurisdiction: lookup.governmentJurisdiction }),
      this.vault.isAvailable(),
    ]);
    const emailAvailable = isApprovedManagedEmail(emailIdentity);
    const policy = evaluateAutomaticRegistrationPolicy({
      ...inspection,
      managedEmailIdentityAvailable: emailAvailable,
      credentialStorageAvailable,
    });

    if (!policy.allowed) {
      const account = this.repository.save(makeBlockedAccount(existing, request, policy, this.isoNow()));
      return {
        outcome: policy.humanActionRequired ? 'human_action_required' : 'blocked',
        account,
        policy,
      };
    }

    // evaluateAutomaticRegistrationPolicy guarantees these at this point.
    const identity = emailIdentity!;
    const now = this.isoNow();
    const accountId = existing?.accountId ?? crypto.randomUUID();
    const username = existing?.username || generateManagedUsername(lookup.governmentJurisdiction);
    const password = generateStrongRandomPassword();
    const stored = await this.vault.store({ scope: `${lookup.siteDomain}/${accountId}`, username, password });
    if (!stored.credentialHandle || containsSecretMaterial(stored.credentialHandle)) {
      const account = this.repository.save(makeBlockedAccount(existing, request, blocked('credential_storage_unavailable', CREDENTIAL_STORAGE_UNAVAILABLE_REASON, true), now));
      return { outcome: 'human_action_required', account, policy };
    }

    let account = this.repository.save({
      accountId,
      siteDomain: lookup.siteDomain,
      governmentJurisdiction: lookup.governmentJurisdiction,
      platform: lookup.platform,
      purpose: clean(request.purpose),
      username,
      emailAliasReference: identity.aliasReference,
      credentialHandle: stored.credentialHandle,
      accountStatus: 'registration_pending',
      emailVerificationStatus: 'not_required',
      createdAt: existing?.createdAt ?? now,
      lastSuccessfulLogin: existing?.lastSuccessfulLogin ?? null,
      lastPasswordRotation: now,
      recoveryStatus: 'not_needed',
      termsVersion: inspection.termsVersion ? clean(inspection.termsVersion) : null,
      registrationDate: null,
      failureReason: null,
      sessionState: 'none',
      humanActionRequired: false,
      humanActionReason: null,
      updatedAt: now,
    });

    const registration = await request.registrar.register({ username, emailAddress: identity.address, password });
    const registeredAt = registration.status === 'active' || registration.status === 'verification_required'
      ? registration.registeredAt ?? now
      : null;

    if (registration.status === 'active') {
      account = this.repository.save({
        ...account,
        accountStatus: 'active', emailVerificationStatus: 'not_required', registrationDate: registeredAt,
        lastSuccessfulLogin: registration.sessionState === 'authenticated' ? now : null,
        sessionState: registration.sessionState ?? 'unknown', updatedAt: this.isoNow(),
      });
      return { outcome: 'created', account, policy };
    }
    if (registration.status === 'human_action_required') {
      account = this.repository.save(humanAction(account, registration.reason, this.isoNow()));
      return { outcome: 'human_action_required', account, policy };
    }
    if (registration.status === 'failed') {
      account = this.repository.save({ ...account, accountStatus: 'blocked', failureReason: safeReason(registration.reason), updatedAt: this.isoNow() });
      return { outcome: 'failed', account, policy };
    }

    account = this.repository.save({
      ...account,
      accountStatus: 'verification_pending', emailVerificationStatus: 'pending', registrationDate: registeredAt,
      sessionState: 'none', updatedAt: this.isoNow(),
    });
    if (!this.mailbox || !(await this.mailbox.isAvailable())) {
      account = this.repository.save({
        ...account,
        emailVerificationStatus: 'mailbox_unavailable',
        failureReason: 'Approved verification mailbox access unavailable.',
        humanActionRequired: true,
        humanActionReason: 'Complete the account email verification using an approved LandOS-controlled mailbox.',
        updatedAt: this.isoNow(),
      });
      return { outcome: 'verification_pending', account, policy };
    }

    const challenge = await this.mailbox.retrieve({
      aliasReference: identity.aliasReference,
      expectedSenderDomain: normalizeDomain(registration.expectedSenderDomain),
      requestedAfter: registeredAt ?? now,
      timeoutMs: boundedTimeout(request.verificationTimeoutMs),
    });
    if (!challenge) {
      account = this.repository.save({ ...account, failureReason: 'Verification message was not received within the bounded wait.', updatedAt: this.isoNow() });
      return { outcome: 'verification_pending', account, policy };
    }

    const verification = await request.registrar.verify({ challenge });
    if (verification.status === 'active') {
      account = this.repository.save({
        ...account,
        accountStatus: 'active', emailVerificationStatus: 'verified', failureReason: null,
        humanActionRequired: false, humanActionReason: null,
        lastSuccessfulLogin: verification.sessionState === 'authenticated' ? this.isoNow() : account.lastSuccessfulLogin,
        sessionState: verification.sessionState ?? 'unknown', updatedAt: this.isoNow(),
      });
      return { outcome: 'created', account, policy };
    }
    if (verification.status === 'human_action_required') {
      account = this.repository.save(humanAction({ ...account, emailVerificationStatus: 'failed' }, verification.reason, this.isoNow()));
      return { outcome: 'human_action_required', account, policy };
    }
    account = this.repository.save({
      ...account, emailVerificationStatus: 'failed', failureReason: safeReason(verification.reason), updatedAt: this.isoNow(),
    });
    return { outcome: 'failed', account, policy };
  }

  recordLoginSuccess(accountId: string): ManagedGovernmentAccount {
    const account = requiredAccount(this.repository, accountId);
    const now = this.isoNow();
    return this.repository.save({
      ...account, accountStatus: 'active', sessionState: 'authenticated', lastSuccessfulLogin: now,
      failureReason: null, humanActionRequired: false, humanActionReason: null, updatedAt: now,
    });
  }

  markSessionExpired(accountId: string, reason = 'Stored public-record session expired.'): ManagedGovernmentAccount {
    const account = requiredAccount(this.repository, accountId);
    return this.repository.save({
      ...account, accountStatus: 'session_expired', sessionState: 'expired', failureReason: safeReason(reason), updatedAt: this.isoNow(),
    });
  }

  markRecoveryRequired(accountId: string, reason: string, humanActionRequired = false): ManagedGovernmentAccount {
    const account = requiredAccount(this.repository, accountId);
    const now = this.isoNow();
    return this.repository.save({
      ...account,
      accountStatus: humanActionRequired ? 'human_action_required' : 'recovery_required',
      recoveryStatus: humanActionRequired ? 'human_action_required' : 'pending',
      sessionState: 'expired',
      failureReason: safeReason(reason),
      humanActionRequired,
      humanActionReason: humanActionRequired ? safeReason(reason) : null,
      updatedAt: now,
    });
  }

  private isoNow(): string { return this.now().toISOString(); }
}

export function generateStrongRandomPassword(bytes = 24): string {
  if (!Number.isInteger(bytes) || bytes < 18) throw new Error('Managed passwords require at least 18 random bytes.');
  const random = crypto.randomBytes(bytes).toString('base64url');
  // Ensure each commonly-required character class without reducing random entropy.
  return `A9!a${random}`;
}

export function isApprovedManagedEmail(identity: ManagedEmailIdentity | null): identity is ManagedEmailIdentity {
  if (!identity || !identity.receivable || identity.control !== 'verified') return false;
  if (!identity.aliasReference.trim()) return false;
  const at = identity.address.lastIndexOf('@');
  return at > 0 && at < identity.address.length - 3 && !/example\.(com|org|net)$/i.test(identity.address);
}

/** Redacts untrusted adapter text before it reaches account state or logs. */
export function redactAccountSecrets(text: string): string {
  let value = String(text ?? '');
  value = value.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+\/-]{8,}/gi, '$1 [redacted]');
  value = value.replace(/\b(password|passcode|verification(?:\s+code)?|otp|token|secret|cookie|authorization)\s*[:=]\s*\S+/gi, '$1=[redacted]');
  value = value.replace(/([?&](?:token|code|key|secret|signature)=)[^&\s]+/gi, '$1[redacted]');
  return value.slice(0, 500);
}

function assertSafeAccountMetadata(account: ManagedGovernmentAccount): void {
  const record = account as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    // A rotation timestamp is required lifecycle metadata, not password material.
    if (key !== 'lastPasswordRotation'
      && /password|passcode|verification(code|link|url)|\botp\b|cookie|authorization|access.?token|refresh.?token|session.?id/i.test(key)) {
      throw new Error(`Secret field "${key}" cannot be persisted in managed account metadata.`);
    }
    if (typeof value === 'string' && containsSecretMaterial(value)) {
      throw new Error(`Secret-shaped material cannot be persisted in managed account field "${key}".`);
    }
  }
}

function containsSecretMaterial(value: string): boolean {
  return /\b(Bearer|Basic)\s+[A-Za-z0-9._~+\/-]{8,}|\b(password|passcode|verification(?:\s+code)?|otp|token|secret|cookie|authorization)\s*[:=]\s*(?!\[redacted\])\S+|[?&](token|code|key|secret|signature)=[^&\s]+/i.test(value);
}

function normalizeAccount(account: ManagedGovernmentAccount): ManagedGovernmentAccount {
  return {
    ...account,
    siteDomain: normalizeDomain(account.siteDomain),
    governmentJurisdiction: clean(account.governmentJurisdiction),
    platform: clean(account.platform),
    purpose: clean(account.purpose),
    username: clean(account.username),
    emailAliasReference: clean(account.emailAliasReference),
    credentialHandle: clean(account.credentialHandle),
    failureReason: account.failureReason ? safeReason(account.failureReason) : null,
    humanActionReason: account.humanActionReason ? safeReason(account.humanActionReason) : null,
  };
}

function accountFromRow(row: Record<string, unknown>): ManagedGovernmentAccount {
  return {
    accountId: String(row.account_id), siteDomain: String(row.site_domain),
    governmentJurisdiction: String(row.government_jurisdiction), platform: String(row.platform),
    purpose: String(row.purpose), username: String(row.username), emailAliasReference: String(row.email_alias_reference),
    credentialHandle: String(row.credential_handle), accountStatus: row.account_status as GovernmentAccountStatus,
    emailVerificationStatus: row.email_verification_status as EmailVerificationStatus, createdAt: String(row.created_at),
    lastSuccessfulLogin: nullable(row.last_successful_login), lastPasswordRotation: nullable(row.last_password_rotation),
    recoveryStatus: row.recovery_status as AccountRecoveryStatus, termsVersion: nullable(row.terms_version),
    registrationDate: nullable(row.registration_date), failureReason: nullable(row.failure_reason),
    sessionState: row.session_state as SafeSessionState, humanActionRequired: Number(row.human_action_required) === 1,
    humanActionReason: nullable(row.human_action_reason), updatedAt: String(row.updated_at),
  };
}

function makeBlockedAccount(
  existing: ManagedGovernmentAccount | null,
  request: Omit<EnsureGovernmentAccessRequest, 'registrar'>,
  policy: RegistrationPolicyDecision,
  now: string,
): ManagedGovernmentAccount {
  const lookup = normalizeLookup(request);
  return {
    accountId: existing?.accountId ?? crypto.randomUUID(),
    siteDomain: lookup.siteDomain, governmentJurisdiction: lookup.governmentJurisdiction, platform: lookup.platform,
    purpose: clean(request.purpose), username: existing?.username ?? '', emailAliasReference: existing?.emailAliasReference ?? '',
    credentialHandle: existing?.credentialHandle ?? '', accountStatus: policy.humanActionRequired ? 'human_action_required' : 'blocked',
    emailVerificationStatus: existing?.emailVerificationStatus ?? 'not_required', createdAt: existing?.createdAt ?? now,
    lastSuccessfulLogin: existing?.lastSuccessfulLogin ?? null, lastPasswordRotation: existing?.lastPasswordRotation ?? null,
    recoveryStatus: existing?.recoveryStatus ?? 'not_needed', termsVersion: existing?.termsVersion ?? null,
    registrationDate: existing?.registrationDate ?? null, failureReason: policy.reason,
    sessionState: existing?.sessionState ?? 'none', humanActionRequired: policy.humanActionRequired,
    humanActionReason: policy.humanActionRequired ? policy.reason : null, updatedAt: now,
  };
}

function humanAction(account: ManagedGovernmentAccount, reason: string, now: string): ManagedGovernmentAccount {
  const safe = safeReason(reason);
  return { ...account, accountStatus: 'human_action_required', failureReason: safe, humanActionRequired: true, humanActionReason: safe, updatedAt: now };
}

function requiredAccount(repository: GovernmentAccountRepository, accountId: string): ManagedGovernmentAccount {
  const account = repository.get(accountId);
  if (!account) throw new Error(`Managed government account ${accountId} was not found.`);
  return account;
}

function generateManagedUsername(jurisdiction: string): string {
  const slug = clean(jurisdiction).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 28) || 'records';
  return `landos_${slug}_${crypto.randomBytes(4).toString('hex')}`;
}

function normalizeLookup(input: AccountLookup): AccountLookup {
  return { siteDomain: normalizeDomain(input.siteDomain), governmentJurisdiction: clean(input.governmentJurisdiction), platform: clean(input.platform) };
}

function normalizeDomain(input: string): string {
  const value = clean(input).toLowerCase();
  try { return new URL(value.includes('://') ? value : `https://${value}`).hostname.replace(/^www\./, ''); }
  catch { return value.replace(/^www\./, '').split('/')[0]; }
}

function boundedTimeout(value = 30_000): number { return Math.max(1_000, Math.min(60_000, Math.floor(value))); }
function safeReason(value: string): string { return redactAccountSecrets(clean(value)) || 'Account access could not be completed.'; }
function clean(value: string): string { return String(value ?? '').trim().replace(/\s+/g, ' '); }
function nullable(value: unknown): string | null { return value === null || value === undefined ? null : String(value); }
