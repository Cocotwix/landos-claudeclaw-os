import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import {
  CREDENTIAL_STORAGE_UNAVAILABLE_REASON, GovernmentAccountManager, MANAGED_EMAIL_UNAVAILABLE_REASON,
  SqliteGovernmentAccountRepository, evaluateAutomaticRegistrationPolicy, generateStrongRandomPassword,
  isApprovedManagedEmail, type CredentialVault, type GovernmentRegistrationAdapter,
  type ManagedEmailIdentityProvider, type RegistrationInspection, type VerificationMailbox,
} from './government-account-manager.js';

const NOW = new Date('2026-07-12T18:00:00Z');
const eligible = (over: Partial<RegistrationInspection> = {}): RegistrationInspection => ({
  siteKind: 'official_government', publicPropertyInformationPurpose: true, free: true,
  paymentMethodRequested: false, sensitiveIdentityVerificationRequired: false, captchaRequired: false,
  phoneVerificationRequired: false, approvedCompanyPhoneAvailable: false, terms: 'ordinary_technical',
  prohibitsIntendedAutomation: false, truthfulMandatoryFieldsAvailable: true, termsVersion: '2026-01', ...over,
});
const approvedEmail: ManagedEmailIdentityProvider = {
  // Reserved .test domain: fixture only, never a live-account claim.
  async resolve() { return { address: 'landos+monroe@company.test', aliasReference: 'alias/monroe', receivable: true, control: 'verified' }; },
};
function setup() {
  const db = new Database(':memory:');
  return { db, repository: new SqliteGovernmentAccountRepository(db) };
}
function vault(available = true): CredentialVault & { secret: string | null } {
  return {
    secret: null, async isAvailable() { return available; },
    async store(input) { this.secret = input.password; return { credentialHandle: 'vault://government/monroe-1' }; },
  };
}
function registrar(
  inspection: RegistrationInspection,
  registration: Awaited<ReturnType<GovernmentRegistrationAdapter['register']>> = { status: 'active', sessionState: 'authenticated' },
): GovernmentRegistrationAdapter & { registrations: number; verifications: number; transient: string | null } {
  return {
    registrations: 0, verifications: 0, transient: null, async inspect() { return inspection; },
    async register(input) { this.registrations++; this.transient = input.password; return registration; },
    async verify() { this.verifications++; return { status: 'active', sessionState: 'authenticated' }; },
  };
}
const request = (adapter: GovernmentRegistrationAdapter) => ({
  siteDomain: 'records.monroetn.gov', governmentJurisdiction: 'Monroe County, TN',
  platform: 'County Records', purpose: 'Public parcel research', registrar: adapter,
});

describe('automatic government-account policy (unit)', () => {
  const decide = (over: Partial<RegistrationInspection & { managedEmailIdentityAvailable: boolean; credentialStorageAvailable: boolean }> = {}) =>
    evaluateAutomaticRegistrationPolicy({ ...eligible(), managedEmailIdentityAvailable: true, credentialStorageAvailable: true, ...over });
  it('allows eligible free public-record registration', () => {
    expect(decide()).toMatchObject({ allowed: true, code: 'auto_registration_allowed' });
  });
  it.each([
    [{ free: false }, 'paid_access_required'],
    [{ paymentMethodRequested: true }, 'paid_access_required'],
    [{ captchaRequired: true }, 'captcha_human_action_required'],
    [{ sensitiveIdentityVerificationRequired: true }, 'sensitive_identity_verification_required'],
    [{ terms: 'material' as const }, 'material_legal_terms_review_required'],
    [{ terms: 'unknown' as const }, 'material_legal_terms_review_required'],
    [{ prohibitsIntendedAutomation: true }, 'automation_prohibited'],
    [{ truthfulMandatoryFieldsAvailable: false }, 'truthful_required_field_unavailable'],
    [{ phoneVerificationRequired: true, approvedCompanyPhoneAvailable: false }, 'phone_verification_unavailable'],
    [{ siteKind: 'other' as const }, 'ineligible_site'],
  ])('blocks unsafe signal %#', (over, code) => expect(decide(over)).toMatchObject({ allowed: false, code }));
  it('uses exact email and vault blockers', () => {
    expect(decide({ managedEmailIdentityAvailable: false })).toMatchObject({ reason: MANAGED_EMAIL_UNAVAILABLE_REASON });
    expect(decide({ credentialStorageAvailable: false })).toMatchObject({ reason: CREDENTIAL_STORAGE_UNAVAILABLE_REASON });
  });
  it('rejects invented, unverified, and non-receivable addresses', () => {
    expect(isApprovedManagedEmail({ address: 'x@example.com', aliasReference: 'x', receivable: true, control: 'verified' })).toBe(false);
    expect(isApprovedManagedEmail({ address: 'x@company.test', aliasReference: 'x', receivable: false, control: 'verified' })).toBe(false);
    expect(isApprovedManagedEmail({ address: 'x@company.test', aliasReference: 'x', receivable: true, control: 'unverified' })).toBe(false);
  });
});

describe('GovernmentAccountManager (fixture contract)', () => {
  it('registers, safely persists, and reuses an eligible account', async () => {
    const { db, repository } = setup(); const v = vault(); const r = registrar(eligible());
    const manager = new GovernmentAccountManager(repository, approvedEmail, v, undefined, () => NOW);
    const result = await manager.ensureAccess(request(r));
    expect(result.account).toMatchObject({
      accountStatus: 'active', emailAliasReference: 'alias/monroe',
      credentialHandle: 'vault://government/monroe-1', sessionState: 'authenticated',
    });
    expect(r.transient).toBe(v.secret);
    const raw = db.prepare('SELECT * FROM landos_government_account').get() as Record<string, unknown>;
    expect(JSON.stringify(raw)).not.toContain(v.secret!);
    expect(Object.keys(raw)).not.toEqual(expect.arrayContaining([
      'password', 'verification_code', 'verification_link', 'cookie', 'access_token', 'refresh_token',
    ]));
    expect(new SqliteGovernmentAccountRepository(db).find({
      siteDomain: 'records.monroetn.gov', governmentJurisdiction: 'Monroe County, TN', platform: 'County Records',
    })?.accountStatus).toBe('active');
    expect((await manager.ensureAccess(request(r))).outcome).toBe('reused');
    expect(r.registrations).toBe(1);
  });
  it('blocks only the provider when managed email is unavailable', async () => {
    const { repository } = setup(); const r = registrar(eligible());
    const noEmail: ManagedEmailIdentityProvider = { async resolve() { return null; } };
    const result = await new GovernmentAccountManager(repository, noEmail, vault(), undefined, () => NOW).ensureAccess(request(r));
    expect(result.account).toMatchObject({ failureReason: MANAGED_EMAIL_UNAVAILABLE_REASON, accountStatus: 'human_action_required' });
    expect(r.registrations).toBe(0);
  });
  it('does not register for payment, CAPTCHA, or material terms', async () => {
    for (const inspection of [eligible({ paymentMethodRequested: true }), eligible({ captchaRequired: true }), eligible({ terms: 'material' })]) {
      const { repository } = setup(); const r = registrar(inspection);
      await new GovernmentAccountManager(repository, approvedEmail, vault(), undefined, () => NOW).ensureAccess(request(r));
      expect(r.registrations).toBe(0);
    }
  });
  it('completes bounded verification without persisting its transient code', async () => {
    const { db, repository } = setup();
    const r = registrar(eligible(), { status: 'verification_required', expectedSenderDomain: 'records.monroetn.gov' });
    let timeout = 0;
    const transientChallenge = crypto.randomUUID();
    const mailbox: VerificationMailbox = {
      async isAvailable() { return true; },
      async retrieve(input) { timeout = input.timeoutMs; return { kind: 'code', value: transientChallenge }; },
    };
    const result = await new GovernmentAccountManager(repository, approvedEmail, vault(), mailbox, () => NOW)
      .ensureAccess({ ...request(r), verificationTimeoutMs: 999_999 });
    expect(result.account).toMatchObject({ accountStatus: 'active', emailVerificationStatus: 'verified' });
    expect(timeout).toBe(60_000);
    expect(JSON.stringify(db.prepare('SELECT * FROM landos_government_account').get())).not.toContain(transientChallenge);
  });
  it('records verification pending when mailbox access is absent', async () => {
    const { repository } = setup();
    const r = registrar(eligible(), { status: 'verification_required', expectedSenderDomain: 'records.monroetn.gov' });
    const result = await new GovernmentAccountManager(repository, approvedEmail, vault(), undefined, () => NOW).ensureAccess(request(r));
    expect(result.account).toMatchObject({
      emailVerificationStatus: 'mailbox_unavailable', humanActionRequired: true,
      failureReason: 'Approved verification mailbox access unavailable.',
    });
    expect((await new GovernmentAccountManager(repository, approvedEmail, vault(), undefined, () => NOW)
      .ensureAccess(request(r))).outcome).toBe('verification_pending');
    expect(r.registrations).toBe(1);
  });
  it('rejects secret-shaped metadata and generates strong unique passwords', () => {
    const { repository } = setup();
    const transientSecret = generateStrongRandomPassword();
    expect(() => repository.save({
      accountId: 'a', siteDomain: 'records.gov', governmentJurisdiction: 'County, TN', platform: 'Custom',
      purpose: 'Public records', username: 'landos_records', emailAliasReference: 'alias/ref', credentialHandle: 'vault://safe/1',
      accountStatus: 'blocked', emailVerificationStatus: 'not_required', createdAt: NOW.toISOString(),
      lastSuccessfulLogin: null, lastPasswordRotation: null, recoveryStatus: 'not_needed', termsVersion: null,
      registrationDate: null, failureReason: 'password=' + transientSecret, sessionState: 'none',
      humanActionRequired: false, humanActionReason: null, updatedAt: NOW.toISOString(),
    })).toThrow(/secret-shaped/i);
    const one = generateStrongRandomPassword(), two = generateStrongRandomPassword();
    expect(one).not.toBe(two); expect(one).toMatch(/[A-Z]/); expect(one).toMatch(/[a-z]/);
    expect(one).toMatch(/[0-9]/); expect(one).toMatch(/[^A-Za-z0-9]/);
  });
});
