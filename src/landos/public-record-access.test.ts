import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  GovernmentAccountManager,
  SqliteGovernmentAccountRepository,
  type CredentialVault,
  type GovernmentRegistrationAdapter,
  type ManagedEmailIdentityProvider,
  type RegistrationInspection,
} from './government-account-manager.js';
import {
  attachOperatorAccount,
  ensurePublicRecordAccess,
  type PublicRecordAccessDeps,
  type PublicRecordAccessResult,
  type PublicRecordLoginAdapter,
  type PublicRecordLoginResult,
} from './public-record-access.js';
import {
  PublicRecordSessionStore,
  type SessionMaterialVault,
} from './public-record-session-store.js';
import { PublicRecordAccessStore } from './public-record-access-store.js';
import {
  accountScopeKey,
  credentialAppliesTo,
  resolveAccountScope,
  type AccessTarget,
} from './public-record-access-types.js';
import { assertNoCredentialExposure, buildPublicRecordAccessView } from './public-record-access-view.js';
import { detectAccessRequirement, type AuthDetection } from './public-record-auth-detection.js';
import { AccessSignalCollector, withAccessSignals } from './public-record-access-transport.js';

/* ─────────────────────────────── fixtures ────────────────────────────── */

const NOW = '2026-08-06T12:00:00.000Z';
const temps: string[] = [];
afterEach(() => {
  for (const file of temps.splice(0)) { try { fs.rmSync(file, { force: true }); } catch { /* gone */ } }
});

function tempDbPath(): string {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'landos-access-')), 'access.db');
  temps.push(file);
  return file;
}

/** An in-memory stand-in for the DPAPI vault: same contract, no Windows. */
function fakeVault(available = true) {
  const secrets = new Map<string, string>();
  let counter = 0;
  const vault: CredentialVault & SessionMaterialVault & { secrets: Map<string, string> } = {
    secrets,
    async isAvailable() { return available; },
    async store(input) { return vault.put(input); },
    async put(input: { scope: string; password: string }) {
      if (!available) throw new Error('Credential vault unavailable.');
      const handle = `landos-vault:${++counter}`;
      secrets.set(handle, input.password);
      return { credentialHandle: handle };
    },
    async retrieve(handle: string) {
      const value = secrets.get(handle);
      if (!value) throw new Error('Selected credential was not found.');
      return { value };
    },
  };
  return vault;
}

const approvedEmail: ManagedEmailIdentityProvider = {
  // Reserved .test domain: a fixture, never a live-account claim.
  async resolve() { return { address: 'records@landos.test', aliasReference: 'alias/records', receivable: true, control: 'verified' }; },
};

const eligibleInspection = (over: Partial<RegistrationInspection> = {}): RegistrationInspection => ({
  siteKind: 'official_government', publicPropertyInformationPurpose: true, free: true,
  paymentMethodRequested: false, sensitiveIdentityVerificationRequired: false, captchaRequired: false,
  phoneVerificationRequired: false, approvedCompanyPhoneAvailable: false, terms: 'ordinary_technical',
  prohibitsIntendedAutomation: false, truthfulMandatoryFieldsAvailable: true, termsVersion: '2026-01', ...over,
});

function registrar(
  inspection = eligibleInspection(),
  registration: Awaited<ReturnType<GovernmentRegistrationAdapter['register']>> = { status: 'active', sessionState: 'authenticated' },
) {
  return {
    registrations: 0,
    passwords: [] as string[],
    async inspect() { return inspection; },
    async register(input: { password: string }) { this.registrations++; this.passwords.push(input.password); return registration; },
    async verify() { return { status: 'active' as const, sessionState: 'authenticated' as const }; },
  };
}

interface ScriptedLogin extends PublicRecordLoginAdapter {
  attempts: Array<{ username: string; loginUrl: string | null }>;
  resumes: number;
  resumeResult: 'authenticated' | 'expired';
}

function loginAdapter(results: PublicRecordLoginResult[]): ScriptedLogin {
  const queue = [...results];
  const adapter: ScriptedLogin = {
    attempts: [],
    resumes: 0,
    resumeResult: 'authenticated',
    async login(input) {
      adapter.attempts.push({ username: input.username, loginUrl: input.loginUrl });
      return queue.shift() ?? { status: 'failed', reason: 'no scripted result' };
    },
    async resume() { adapter.resumes += 1; return { status: adapter.resumeResult }; },
  };
  return adapter;
}

const AUTH_REQUIRED: AuthDetection = {
  requirement: 'auth_required', registration: 'free_registration_supported',
  loginUrl: 'https://records.alpha-county.gov/login', registrationUrl: 'https://records.alpha-county.gov/register',
  paidRecordsObserved: false, signals: ['Login required'],
};
const AUTH_NOT_REQUIRED: AuthDetection = {
  requirement: 'auth_not_required', registration: 'not_applicable',
  loginUrl: null, registrationUrl: null, paidRecordsObserved: false, signals: [],
};
const PAID: AuthDetection = { ...AUTH_REQUIRED, registration: 'paid_access_required', signals: ['Subscription required'] };

const ALPHA: AccessTarget = { providerFamily: 'schneider_beacon_qpublic', deploymentDomain: 'records.alpha-county.gov', jurisdiction: 'Alpha County, GA' };
const BETA: AccessTarget = { providerFamily: 'schneider_beacon_qpublic', deploymentDomain: 'records.beta-county.gov', jurisdiction: 'Beta County, GA' };
const OTHER_VENDOR: AccessTarget = { providerFamily: 'tyler_iasworld', deploymentDomain: 'records.alpha-county.gov', jurisdiction: 'Alpha County, GA' };

function harness(dbPath: string | ':memory:' = ':memory:', vault = fakeVault()) {
  const db = new Database(dbPath);
  const repository = new SqliteGovernmentAccountRepository(db);
  const sessions = new PublicRecordSessionStore(db);
  const accounts = new GovernmentAccountManager(repository, approvedEmail, vault, undefined, () => new Date(NOW));
  const deps: PublicRecordAccessDeps = { repository, accounts, sessions, vault, now: () => NOW };
  return { db, repository, sessions, accounts, vault, deps };
}

/* ─────────────────────────────── scope ───────────────────────────────── */

describe('credential scope', () => {
  it('defaults to the narrowest scope and widens only on evidence', () => {
    expect(resolveAccountScope({ target: ALPHA })).toBe('deployment');
    expect(resolveAccountScope({ target: ALPHA, jurisdictionLevelProven: true })).toBe('jurisdiction');
    expect(resolveAccountScope({ target: ALPHA, providerLevelProven: true })).toBe('provider');
    // Jurisdiction scope is refused when there is no jurisdiction to scope to.
    expect(resolveAccountScope({ target: { ...ALPHA, jurisdiction: '' }, jurisdictionLevelProven: true })).toBe('deployment');
  });

  it('never lets one deployment credential reach another', () => {
    const account = { accountScope: 'deployment' as const, scopeKey: accountScopeKey('deployment', ALPHA) };
    expect(credentialAppliesTo(account, ALPHA)).toBe(true);
    expect(credentialAppliesTo(account, BETA)).toBe(false);
  });

  it('never lets one vendor credential reach another vendor on the same host', () => {
    const account = { accountScope: 'provider' as const, scopeKey: accountScopeKey('provider', ALPHA) };
    expect(credentialAppliesTo(account, BETA)).toBe(true);
    expect(credentialAppliesTo(account, OTHER_VENDOR)).toBe(false);
  });

  it('does not widen a jurisdiction credential to a sibling county', () => {
    const account = { accountScope: 'jurisdiction' as const, scopeKey: accountScopeKey('jurisdiction', ALPHA) };
    expect(credentialAppliesTo(account, { ...ALPHA, deploymentDomain: 'gis.alpha-county.gov' })).toBe(true);
    expect(credentialAppliesTo(account, BETA)).toBe(false);
    expect(credentialAppliesTo(account, { ...ALPHA, jurisdiction: '' })).toBe(false);
  });
});

/* ───────────────────────── the access decision path ──────────────────── */

describe('ensurePublicRecordAccess', () => {
  it('CASE A — an open source creates no account at all', async () => {
    const { deps, repository } = harness();
    const reg = registrar();
    const result = await ensurePublicRecordAccess({ target: ALPHA, detection: AUTH_NOT_REQUIRED, registrar: reg }, deps);
    expect(result.outcome).toBe('auth_not_required');
    expect(result.capabilities).toContain('AUTH_NOT_REQUIRED');
    expect(result.account).toBeNull();
    expect(reg.registrations).toBe(0);
    expect(repository.list()).toHaveLength(0);
  });

  it('CASE C — paid access stops before registration and never purchases', async () => {
    const { deps, repository } = harness();
    const reg = registrar();
    const result = await ensurePublicRecordAccess({ target: ALPHA, detection: PAID, registrar: reg }, deps);
    expect(result.outcome).toBe('paid_access_required');
    expect(result.reason).toContain('PAID ACCESS REQUIRES OPERATOR APPROVAL');
    expect(result.capabilities).toContain('PAID_ACCESS_REQUIRED');
    expect(result.purchaseAttempted).toBe(false);
    expect(reg.registrations).toBe(0);
    expect(repository.list()).toHaveLength(0);
  });

  it('never registers on an unobserved requirement', async () => {
    const { deps } = harness();
    const reg = registrar();
    const result = await ensurePublicRecordAccess(
      { target: ALPHA, detection: { ...AUTH_REQUIRED, requirement: 'unknown' }, registrar: reg }, deps,
    );
    expect(result.outcome).toBe('unknown');
    expect(reg.registrations).toBe(0);
  });

  it('CASE B — creates exactly one free account and stores only a vault reference', async () => {
    const { deps, repository, vault, db } = harness();
    const reg = registrar();
    const result = await ensurePublicRecordAccess({ target: ALPHA, detection: AUTH_REQUIRED, registrar: reg }, deps);

    expect(result.outcome).toBe('account_created');
    expect(result.registrationAttempted).toBe(true);
    expect(result.scope).toBe('deployment');
    expect(result.capabilities).toEqual(expect.arrayContaining(['AUTH_REQUIRED', 'FREE_REGISTRATION_SUPPORTED', 'LOGIN_ACCOUNT_AVAILABLE']));
    expect(result.account).toMatchObject({
      accountStatus: 'active', providerFamily: 'schneider_beacon_qpublic',
      accountScope: 'deployment', scopeKey: accountScopeKey('deployment', ALPHA),
      loginUrl: 'https://records.alpha-county.gov/login',
      registrationUrl: 'https://records.alpha-county.gov/register',
    });

    // The password reached the registrar and the vault, and nowhere else.
    const password = reg.passwords[0];
    expect(password).toBeTruthy();
    expect([...vault.secrets.values()]).toContain(password);
    const rows = JSON.stringify(db.prepare('SELECT * FROM landos_government_account').all());
    expect(rows).not.toContain(password);
    expect(result.account!.credentialHandle).toMatch(/^landos-vault:/);
    expect(JSON.stringify(result)).not.toContain(password);
  });

  it('does not create a second account when one already fits', async () => {
    const { deps, repository } = harness();
    const reg = registrar();
    await ensurePublicRecordAccess({ target: ALPHA, detection: AUTH_REQUIRED, registrar: reg }, deps);
    const again = await ensurePublicRecordAccess({ target: ALPHA, detection: AUTH_REQUIRED, registrar: reg }, deps);

    expect(again.outcome).toBe('account_reused');
    expect(again.registrationAttempted).toBe(false);
    expect(reg.registrations).toBe(1);
    expect(repository.list()).toHaveLength(1);
  });

  it('surfaces a verification-pending account instead of registering again', async () => {
    const { deps, repository } = harness();
    const reg = registrar(eligibleInspection(), { status: 'verification_required', expectedSenderDomain: 'records.alpha-county.gov' });
    const first = await ensurePublicRecordAccess({ target: ALPHA, detection: AUTH_REQUIRED, registrar: reg }, deps);
    expect(first.outcome).toBe('verification_pending');
    expect(first.capabilities).toContain('LOGIN_VERIFICATION_PENDING');

    const second = await ensurePublicRecordAccess({ target: ALPHA, detection: AUTH_REQUIRED, registrar: reg }, deps);
    expect(second.outcome).toBe('verification_pending');
    expect(reg.registrations).toBe(1);
    expect(repository.list()).toHaveLength(1);
  });

  it('stops on sensitive identity, CAPTCHA and material terms without registering', async () => {
    for (const [inspection, expected] of [
      [eligibleInspection({ sensitiveIdentityVerificationRequired: true }), 'blocked'],
      [eligibleInspection({ captchaRequired: true }), 'human_action_required'],
      [eligibleInspection({ terms: 'material' as const }), 'human_action_required'],
    ] as const) {
      const { deps } = harness();
      const reg = registrar(inspection);
      const result = await ensurePublicRecordAccess({ target: ALPHA, detection: AUTH_REQUIRED, registrar: reg }, deps);
      expect(result.outcome).toBe(expected);
      expect(reg.registrations).toBe(0);
    }
  });

  it('reports honestly when a source needs an account and none can be created', async () => {
    const { deps } = harness();
    const result = await ensurePublicRecordAccess({ target: ALPHA, detection: { ...AUTH_REQUIRED, registration: 'unsupported_registration' }, registrar: registrar() }, deps);
    expect(result.outcome).toBe('registration_unavailable');
  });
});

/* ──────────────────────────── login and sessions ─────────────────────── */

describe('login, session reuse and reauthentication', () => {
  async function withActiveAccount(dbPath: string | ':memory:' = ':memory:') {
    const vault = fakeVault();
    const h = harness(dbPath, vault);
    await ensurePublicRecordAccess({ target: ALPHA, detection: AUTH_REQUIRED, registrar: registrar() }, h.deps);
    return h;
  }

  it('signs in with the stored credential and keeps a reusable session', async () => {
    const h = await withActiveAccount();
    const login = loginAdapter([{ status: 'authenticated', sessionMaterial: 'opaque-state-1' }]);
    const result = await ensurePublicRecordAccess({ target: ALPHA, detection: AUTH_REQUIRED, login }, h.deps);

    expect(result.outcome).toBe('account_reused');
    expect(login.attempts).toHaveLength(1);
    expect(login.attempts[0].loginUrl).toBe('https://records.alpha-county.gov/login');
    expect(result.session?.state).toBe('authenticated');
    // The authenticated material went to the vault; SQLite holds only a handle.
    expect(result.session?.stateHandle).toMatch(/^landos-vault:/);
    const rows = JSON.stringify(h.db.prepare('SELECT * FROM landos_public_record_session').all());
    expect(rows).not.toContain('opaque-state-1');
  });

  it('reuses the session on the next property instead of logging in again', async () => {
    const h = await withActiveAccount();
    const login = loginAdapter([{ status: 'authenticated', sessionMaterial: 'opaque-state-1' }]);
    await ensurePublicRecordAccess({ target: ALPHA, detection: AUTH_REQUIRED, login }, h.deps);

    const second = await ensurePublicRecordAccess({ target: ALPHA, detection: AUTH_REQUIRED, login }, h.deps);
    expect(second.outcome).toBe('session_reused');
    expect(login.attempts).toHaveLength(1);
    expect(login.resumes).toBe(1);
  });

  it('reauthenticates when the stored session no longer works', async () => {
    const h = await withActiveAccount();
    const login = loginAdapter([
      { status: 'authenticated', sessionMaterial: 'opaque-state-1' },
      { status: 'authenticated', sessionMaterial: 'opaque-state-2' },
    ]);
    await ensurePublicRecordAccess({ target: ALPHA, detection: AUTH_REQUIRED, login }, h.deps);

    login.resumeResult = 'expired';
    const second = await ensurePublicRecordAccess({ target: ALPHA, detection: AUTH_REQUIRED, login }, h.deps);
    expect(second.outcome).toBe('account_reused');
    expect(login.attempts).toHaveLength(2);
    expect(second.session?.state).toBe('authenticated');
  });

  it('honours a stated expiry without guessing one that was never stated', async () => {
    const h = await withActiveAccount();
    const login = loginAdapter([
      { status: 'authenticated', sessionMaterial: 'state', expiresAt: '2026-08-06T11:00:00.000Z' },
      { status: 'authenticated', sessionMaterial: 'state-2' },
    ]);
    await ensurePublicRecordAccess({ target: ALPHA, detection: AUTH_REQUIRED, login }, h.deps);
    const second = await ensurePublicRecordAccess({ target: ALPHA, detection: AUTH_REQUIRED, login }, h.deps);
    expect(second.outcome).toBe('account_reused');
    expect(login.attempts).toHaveLength(2);
  });

  it('a failed login NEVER becomes a second account', async () => {
    for (const [failure, outcome] of [
      [{ status: 'invalid_credentials' as const, reason: 'rejected' }, 'human_action_required'],
      [{ status: 'locked' as const, reason: 'too many attempts' }, 'human_action_required'],
      [{ status: 'password_reset_required' as const }, 'human_action_required'],
      [{ status: 'failed' as const, reason: 'portal error' }, 'login_failed'],
    ] as const) {
      const h = await withActiveAccount();
      const reg = registrar();
      const login = loginAdapter([failure]);
      const result = await ensurePublicRecordAccess({ target: ALPHA, detection: AUTH_REQUIRED, login, registrar: reg }, h.deps);
      expect(result.outcome).toBe(outcome);
      expect(reg.registrations).toBe(0);
      expect(h.repository.list()).toHaveLength(1);
    }
  });

  it('does not present one county session to another county', async () => {
    const h = await withActiveAccount();
    const login = loginAdapter([{ status: 'authenticated', sessionMaterial: 'alpha-state' }]);
    await ensurePublicRecordAccess({ target: ALPHA, detection: AUTH_REQUIRED, login }, h.deps);

    expect(h.sessions.findFor(BETA)).toBeNull();
    expect(h.sessions.findFor(OTHER_VENDOR)).toBeNull();
    expect(h.sessions.findFor(ALPHA)).not.toBeNull();
  });
});

/* ──────────────────────────── isolation and reuse ────────────────────── */

describe('provider and jurisdiction isolation', () => {
  it('does not reuse an Alpha County account for Beta County', async () => {
    const { deps, repository } = harness();
    const reg = registrar();
    await ensurePublicRecordAccess({ target: ALPHA, detection: AUTH_REQUIRED, registrar: reg }, deps);
    const beta = await ensurePublicRecordAccess({ target: BETA, detection: AUTH_REQUIRED, registrar: reg }, deps);

    expect(beta.outcome).toBe('account_created');
    expect(reg.registrations).toBe(2);
    expect(repository.findReusable(BETA)!.accountId).not.toBe(repository.findReusable(ALPHA)!.accountId);
  });

  it('reuses a provider-scoped account across jurisdictions, and only within that provider', async () => {
    const { deps, repository } = harness();
    const reg = registrar();
    const created = await ensurePublicRecordAccess(
      { target: ALPHA, detection: AUTH_REQUIRED, registrar: reg, providerLevelProven: true }, deps,
    );
    expect(created.scope).toBe('provider');

    const beta = await ensurePublicRecordAccess({ target: BETA, detection: AUTH_REQUIRED, registrar: reg }, deps);
    expect(beta.outcome).toBe('account_reused');
    expect(beta.account!.accountId).toBe(created.account!.accountId);
    expect(reg.registrations).toBe(1);

    // A different vendor on the very same hostname is a different account store.
    expect(repository.findReusable(OTHER_VENDOR)).toBeNull();
  });

  it('keeps property evidence out of the shared access tables', () => {
    const db = new Database(':memory:');
    const store = new PublicRecordAccessStore(db);
    expect(() => store.observe(
      { providerFamily: 'arcgis', deploymentDomain: 'gis.alpha-county.gov' },
      { ...AUTH_REQUIRED, loginUrl: 'https://gis.alpha-county.gov/parcelid/10.00-1-64.22' },
      NOW,
    )).toThrow(/property evidence/i);
  });
});

/* ─────────────────────────── operator override ───────────────────────── */

describe('operator-supplied account', () => {
  it('attaches an existing credential without creating a duplicate', async () => {
    const { deps, repository, vault } = harness();
    const { credentialHandle } = await vault.put({ scope: 'operator/alpha', password: 'operator-managed-secret' });

    const attached = attachOperatorAccount(
      { target: ALPHA, username: 'landos_alpha', credentialHandle, loginUrl: 'https://records.alpha-county.gov/login' },
      { repository, now: () => NOW },
    );
    expect(attached).toMatchObject({ accountStatus: 'active', operatorSupplied: true, accountScope: 'deployment' });

    const reg = registrar();
    const result = await ensurePublicRecordAccess({ target: ALPHA, detection: AUTH_REQUIRED, registrar: reg }, deps);
    expect(result.outcome).toBe('account_reused');
    expect(reg.registrations).toBe(0);
    expect(repository.list()).toHaveLength(1);
  });

  it('refuses a raw password in place of a vault reference', () => {
    const { repository } = harness();
    expect(() => attachOperatorAccount(
      { target: ALPHA, username: 'u', credentialHandle: '   ' }, { repository },
    )).toThrow(/credential reference/i);
    expect(() => attachOperatorAccount(
      { target: ALPHA, username: 'u', credentialHandle: 'my secret password' }, { repository },
    )).toThrow(/vault handle/i);
  });
});

/* ─────────────────────────────── persistence ─────────────────────────── */

describe('persistence across refresh and restart', () => {
  it('survives a managed restart and is reused by the next property', async () => {
    const file = tempDbPath();
    const vault = fakeVault();
    const first = harness(file, vault);
    const reg = registrar();
    const created = await ensurePublicRecordAccess({ target: ALPHA, detection: AUTH_REQUIRED, registrar: reg }, first.deps);
    first.deps.sessions.save({
      sessionId: 'session-1', accountId: created.account!.accountId,
      providerFamily: 'schneider_beacon_qpublic', deploymentDomain: 'records.alpha-county.gov',
      accountScope: 'deployment', scopeKey: accountScopeKey('deployment', ALPHA),
      state: 'authenticated', establishedAt: NOW, lastVerifiedAt: NOW, expiresAt: null, stateHandle: null,
    });
    first.db.close();

    // A brand-new process opening the same database file.
    const restarted = harness(file, vault);
    const reused = await ensurePublicRecordAccess({ target: ALPHA, detection: AUTH_REQUIRED, registrar: reg }, restarted.deps);
    expect(reused.outcome).toBe('session_reused');
    expect(reg.registrations).toBe(1);
    expect(restarted.repository.list()).toHaveLength(1);
    restarted.db.close();
  });

  it('remembers a deployment access requirement for the next property', () => {
    const file = tempDbPath();
    const db = new Database(file);
    new PublicRecordAccessStore(db).observe({ providerFamily: 'schneider_beacon_qpublic', deploymentDomain: 'records.alpha-county.gov' }, AUTH_REQUIRED, NOW);
    db.close();

    const reopened = new Database(file);
    const knowledge = new PublicRecordAccessStore(reopened).getByDomain('records.alpha-county.gov');
    expect(knowledge).toMatchObject({ requirement: 'auth_required', registration: 'free_registration_supported', observations: 1 });
    reopened.close();
  });
});

/* ───────────────────────── transport observation ─────────────────────── */

describe('access observation rides on the existing transport', () => {
  it('learns from the responses the GIS ladder already fetched, changing nothing', async () => {
    const collector = new AccessSignalCollector();
    const calls: string[] = [];
    const fetchText = withAccessSignals(async (url: string) => {
      calls.push(url);
      return {
        status: 200, body: '<p>You must be logged in to search.</p><a href="/register">Register</a>',
        url, contentType: 'text/html', blocked: false, via: 'server_fetch' as const,
      };
    }, collector);

    const response = await fetchText('https://records.alpha-county.gov/search');
    expect(response.status).toBe(200);
    expect(calls).toEqual(['https://records.alpha-county.gov/search']);
    expect(collector.get('records.alpha-county.gov')?.requirement).toBe('auth_required');

    const db = new Database(':memory:');
    const store = new PublicRecordAccessStore(db);
    collector.commit(store, () => 'schneider_beacon_qpublic', NOW);
    expect(store.getByDomain('records.alpha-county.gov')?.registration).toBe('free_registration_unproven');
  });

  it('records auth-not-required for a structured lane the observer cannot see', () => {
    // The ArcGIS adapter fetches through its own transport, so the observer
    // riding on fetchText never sees those responses. A structured service that
    // returned the parcel still proves no account was needed — and without this
    // the Access panel stayed blank on the most common platform in the country.
    const db = new Database(':memory:');
    const store = new PublicRecordAccessStore(db);
    store.observe(
      { providerFamily: 'arcgis', deploymentDomain: 'ccgis.cayugacounty.us' },
      {
        requirement: 'auth_not_required', registration: 'not_applicable',
        loginUrl: null, registrationUrl: null, paidRecordsObserved: false,
        signals: ['Structured service returned the parcel without authentication.'],
      },
      NOW,
    );

    const view = buildPublicRecordAccessView('https://ccgis.cayugacounty.us/arcgis/rest/services/Parcels/MapServer/0', {
      store, repository: new SqliteGovernmentAccountRepository(db),
    });
    expect(view).toMatchObject({ present: true, accessLabel: 'No login required', accountLabel: null, actionLabel: null });
    expect(view.capabilities).toEqual(['AUTH_NOT_REQUIRED']);
  });

  it('never fails a retrieval because observation failed', async () => {
    const collector = new AccessSignalCollector();
    const fetchText = withAccessSignals(async (url: string) => ({
      status: 200, body: 'ok', url, contentType: 'text/plain', blocked: false, via: 'server_fetch' as const,
    }), collector);
    // A collector that throws must not surface to the caller.
    (collector as unknown as { observe: () => void }).observe = () => { throw new Error('boom'); };
    await expect(fetchText('https://records.alpha-county.gov/x')).resolves.toMatchObject({ status: 200 });
  });
});

/* ───────────────────────────── operator panel ────────────────────────── */

describe('operator access panel', () => {
  function panelFor(detection: AuthDetection, seed?: (deps: PublicRecordAccessDeps) => Promise<unknown>) {
    const db = new Database(':memory:');
    const store = new PublicRecordAccessStore(db);
    const repository = new SqliteGovernmentAccountRepository(db);
    const sessions = new PublicRecordSessionStore(db);
    const vault = fakeVault();
    const accounts = new GovernmentAccountManager(repository, approvedEmail, vault, undefined, () => new Date(NOW));
    const deps: PublicRecordAccessDeps = { repository, accounts, sessions, vault, now: () => NOW };
    store.observe({ providerFamily: 'schneider_beacon_qpublic', deploymentDomain: 'records.alpha-county.gov' }, detection, NOW);
    return { store, repository, deps, seed };
  }

  it('states an open source plainly and shows no account', () => {
    const { store, repository } = panelFor(AUTH_NOT_REQUIRED);
    const view = buildPublicRecordAccessView('https://records.alpha-county.gov/search', { store, repository });
    expect(view).toMatchObject({ present: true, accessLabel: 'No login required', accountLabel: null, actionLabel: null });
  });

  it('shows the account, its scope and the one operator action', async () => {
    const { store, repository, deps } = panelFor(AUTH_REQUIRED);
    await ensurePublicRecordAccess({ target: ALPHA, detection: AUTH_REQUIRED, registrar: registrar() }, deps);
    const view = buildPublicRecordAccessView('https://records.alpha-county.gov/search', { store, repository });
    expect(view).toMatchObject({
      accessLabel: 'Free login required', accountLabel: 'Active',
      scopeLabel: 'records.alpha-county.gov deployment only', actionLabel: null,
    });
    expect(view.capabilities).toContain('LOGIN_ACCOUNT_AVAILABLE');
  });

  it('tells the operator exactly what to do when verification is pending', async () => {
    const { store, repository, deps } = panelFor(AUTH_REQUIRED);
    await ensurePublicRecordAccess({
      target: ALPHA, detection: AUTH_REQUIRED,
      registrar: registrar(eligibleInspection(), { status: 'verification_required', expectedSenderDomain: 'records.alpha-county.gov' }),
    }, deps);
    const view = buildPublicRecordAccessView('https://records.alpha-county.gov/search', { store, repository });
    expect(view.accountLabel).toBe('Verification pending');
    expect(view.actionLabel).toMatch(/verify/i);
  });

  it('routes paid access to operator approval', () => {
    const { store, repository } = panelFor(PAID);
    const view = buildPublicRecordAccessView('https://records.alpha-county.gov/search', { store, repository });
    expect(view.accessLabel).toBe('Paid access required');
    expect(view.actionLabel).toBe('Operator approval required for paid access');
  });

  it('never exposes a password, a vault handle, or an account email', async () => {
    const { store, repository, deps } = panelFor(AUTH_REQUIRED);
    const created = await ensurePublicRecordAccess({ target: ALPHA, detection: AUTH_REQUIRED, registrar: registrar() }, deps);
    const view = buildPublicRecordAccessView('https://records.alpha-county.gov/search', { store, repository });
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain(created.account!.credentialHandle);
    expect(serialized).not.toMatch(/landos-vault:|@landos\.test|password/i);

    // The panel does not carry the login URL at all, so a handle cannot arrive
    // that way. The invariant is still enforced rather than merely observed:
    // any future field that smuggles one in fails here, not on a screenshot.
    expect(() => assertNoCredentialExposure({ ...view, actionLabel: 'Use landos-vault:1' })).toThrow(/credential reference/i);
    expect(() => assertNoCredentialExposure({ ...view, accountLabel: 'records@landos.test' })).toThrow(/email/i);
    expect(() => assertNoCredentialExposure({ ...view, actionLabel: 'Reset the password' })).toThrow(/password/i);
  });

  it('renders an honest empty state before anything is observed', () => {
    const db = new Database(':memory:');
    const view = buildPublicRecordAccessView('https://never-seen.gov/x', {
      store: new PublicRecordAccessStore(db), repository: new SqliteGovernmentAccountRepository(db),
    });
    expect(view).toMatchObject({ present: false, accountLabel: null, capabilities: [] });
  });
});

/* ─────────────────────────── end-to-end detection ────────────────────── */

describe('detection drives the decision', () => {
  it('an open portal page produces no account; a free-login page produces exactly one', async () => {
    const open = detectAccessRequirement({
      status: 200, contentType: 'application/json', url: 'https://gis.alpha-county.gov/rest/services/Parcels/MapServer/0/query',
      body: '{"features":[{"attributes":{"APN":"10-1"}}]}',
    });
    const gated = detectAccessRequirement({
      status: 200, contentType: 'text/html', url: 'https://records.alpha-county.gov/search',
      body: '<p>You must be logged in to search.</p><p>Create a free account.</p><a href="/register">Register</a>',
    });

    const h = harness();
    const reg = registrar();
    expect((await ensurePublicRecordAccess({ target: ALPHA, detection: open, registrar: reg }, h.deps)).outcome).toBe('auth_not_required');
    expect(reg.registrations).toBe(0);

    const result: PublicRecordAccessResult = await ensurePublicRecordAccess({ target: ALPHA, detection: gated, registrar: reg }, h.deps);
    expect(result.outcome).toBe('account_created');
    expect(reg.registrations).toBe(1);
  });
});
