// LandOS — free public-record ACCESS orchestrator (PART 20).
//
// One entry point that answers a single question for one official source:
// "can LandOS read this, and if not, what is honestly in the way?"
//
// The order is doctrine, not preference:
//
//   1. Money in the way        → stop. Never register, never purchase.
//   2. No account needed       → done. Create nothing.
//   3. An account already fits → reuse it. Reuse its session before its password.
//   4. Only then               → create ONE free account, through the existing
//                                policy engine that refuses anything paid,
//                                identity-verified, CAPTCHA-gated or legally
//                                material.
//
// Two failures this module exists to prevent. First, creating a second account
// because the first one's login failed — a login failure is a login failure,
// and it never becomes a registration. Second, presenting a credential to a
// portal it was not issued for; every reuse passes the scope gate in
// `public-record-access-types.ts`, which is keyed on provider family and can
// never widen.
//
// No password, cookie, token or verification challenge is returned from here,
// logged here, or persisted here.

import {
  GovernmentAccountManager,
  redactAccountSecrets,
  type EnsureGovernmentAccessResult,
  type GovernmentAccountRepository,
  type GovernmentRegistrationAdapter,
  type ManagedGovernmentAccount,
} from './government-account-manager.js';
import {
  accountScopeKey,
  normalizeAccessTarget,
  resolveAccountScope,
  type AccessRequirement,
  type AccessTarget,
  type AccountScope,
  type PublicRecordAccessCapability,
  type RegistrationAvailability,
} from './public-record-access-types.js';
import type { AuthDetection } from './public-record-auth-detection.js';
import {
  newSession,
  sessionExpired,
  type PublicRecordSession,
  type PublicRecordSessionStore,
  type SessionMaterialVault,
} from './public-record-session-store.js';

/* ───────────────────────────── login adapter ─────────────────────────── */

export type PublicRecordLoginResult =
  | { status: 'authenticated'; sessionMaterial?: string; expiresAt?: string }
  | { status: 'invalid_credentials'; reason?: string }
  | { status: 'locked'; reason?: string }
  | { status: 'password_reset_required'; reason?: string }
  | { status: 'human_action_required'; reason: string }
  | { status: 'failed'; reason: string };

/**
 * Supplied by the caller. The background-browser implementation lives with the
 * transport; this module never opens a tab itself, so it can be tested without
 * Chrome and can never surprise the operator with a foreground window.
 */
export interface PublicRecordLoginAdapter {
  login(input: { username: string; password: string; loginUrl: string | null }): Promise<PublicRecordLoginResult>;
  /** Confirm previously stored authenticated material still works. */
  resume?(input: { sessionMaterial: string; loginUrl: string | null }): Promise<{ status: 'authenticated' | 'expired' }>;
}

/* ─────────────────────────────── results ─────────────────────────────── */

export const PUBLIC_RECORD_ACCESS_OUTCOMES = [
  'auth_not_required',
  'session_reused',
  'account_reused',
  'account_created',
  'verification_pending',
  'human_action_required',
  'paid_access_required',
  'registration_unavailable',
  'login_failed',
  'blocked',
  'unknown',
] as const;
export type PublicRecordAccessOutcome = (typeof PUBLIC_RECORD_ACCESS_OUTCOMES)[number];

export interface PublicRecordAccessResult {
  outcome: PublicRecordAccessOutcome;
  requirement: AccessRequirement;
  registration: RegistrationAvailability;
  capabilities: PublicRecordAccessCapability[];
  account: ManagedGovernmentAccount | null;
  session: PublicRecordSession | null;
  scope: AccountScope | null;
  reason: string;
  /** Audit surface. Registration is attempted at most once per call. */
  registrationAttempted: boolean;
  /** Structurally always false. LandOS does not spend money on its own. */
  purchaseAttempted: false;
  /** A free login can still front paid documents. The zoning sprint must know. */
  paidRecordsObserved: boolean;
  observedAt: string;
}

export interface EnsurePublicRecordAccessRequest {
  target: AccessTarget;
  detection: AuthDetection;
  purpose?: string;
  /** Omitted when the caller only wants a read of the access state. */
  registrar?: GovernmentRegistrationAdapter;
  login?: PublicRecordLoginAdapter;
  /** Evidence, never branding, that one account spans this provider. */
  providerLevelProven?: boolean;
  jurisdictionLevelProven?: boolean;
  /** Explicit operator retry after a blocking condition has actually changed. */
  retryExistingAccess?: boolean;
}

export interface PublicRecordAccessDeps {
  repository: GovernmentAccountRepository;
  accounts: GovernmentAccountManager;
  sessions: PublicRecordSessionStore;
  vault: SessionMaterialVault;
  now?: () => string;
}

/* ─────────────────────────── capability handoff ──────────────────────── */

/**
 * What the nationwide zoning sprint will read. Coarse on purpose: it answers
 * "may automation continue here", not "what happened".
 */
export function accessCapabilities(input: {
  requirement: AccessRequirement;
  registration: RegistrationAvailability;
  account: ManagedGovernmentAccount | null;
}): PublicRecordAccessCapability[] {
  const capabilities: PublicRecordAccessCapability[] = [];
  if (input.requirement === 'auth_required') capabilities.push('AUTH_REQUIRED');
  else if (input.requirement === 'auth_optional') capabilities.push('AUTH_OPTIONAL');
  else if (input.requirement === 'auth_not_required') capabilities.push('AUTH_NOT_REQUIRED');

  if (input.registration === 'paid_access_required') capabilities.push('PAID_ACCESS_REQUIRED');
  else if (input.registration === 'free_registration_supported') capabilities.push('FREE_REGISTRATION_SUPPORTED');
  else if (input.registration === 'free_registration_unproven') capabilities.push('FREE_REGISTRATION_UNPROVEN');

  if (input.account?.accountStatus === 'active') capabilities.push('LOGIN_ACCOUNT_AVAILABLE');
  if (input.account?.accountStatus === 'verification_pending'
    || input.account?.emailVerificationStatus === 'pending'
    || input.account?.emailVerificationStatus === 'mailbox_unavailable') {
    capabilities.push('LOGIN_VERIFICATION_PENDING');
  }
  return capabilities;
}

/* ─────────────────────────────── the run ─────────────────────────────── */

export async function ensurePublicRecordAccess(
  request: EnsurePublicRecordAccessRequest,
  deps: PublicRecordAccessDeps,
): Promise<PublicRecordAccessResult> {
  const now = deps.now ?? (() => new Date().toISOString());
  const observedAt = now();
  const target = normalizeAccessTarget(request.target);
  const { requirement, registration } = request.detection;

  const settle = (over: Partial<PublicRecordAccessResult> & { outcome: PublicRecordAccessOutcome; reason: string }): PublicRecordAccessResult => ({
    requirement,
    registration,
    capabilities: accessCapabilities({ requirement, registration, account: over.account ?? null }),
    account: null,
    session: null,
    scope: null,
    registrationAttempted: false,
    purchaseAttempted: false,
    paidRecordsObserved: request.detection.paidRecordsObserved,
    observedAt,
    ...over,
  });

  // 1. Money first. Nothing below this line runs when access costs anything.
  if (registration === 'paid_access_required') {
    return settle({
      outcome: 'paid_access_required',
      reason: 'PAID ACCESS REQUIRES OPERATOR APPROVAL. No account was created and nothing was purchased.',
    });
  }

  // 2. Access that already works needs no account, and creating one anyway
  //    would be an unnecessary identity on a government system.
  if (requirement === 'auth_not_required' || requirement === 'auth_optional') {
    return settle({
      outcome: 'auth_not_required',
      reason: requirement === 'auth_optional'
        ? 'A login exists but the public search answered without one. No account was created.'
        : 'The official source answered without authentication. No account was created.',
    });
  }

  // 3. Never register on a guess. An unobserved requirement is not a demand.
  if (requirement === 'unknown') {
    return settle({
      outcome: 'unknown',
      reason: 'The access requirement was not observed. No account was created.',
    });
  }

  /* ── an account is genuinely required ────────────────────────────────── */

  const existing = deps.repository.findReusable?.(target) ?? null;

  if (existing) {
    const scope = (existing.accountScope ?? 'deployment') as AccountScope;

    if (existing.accountStatus === 'active') {
      const reused = await reuseActiveAccount(existing, target, scope, request, deps, now);
      return settle({ ...reused, account: reused.account ?? existing, scope });
    }

    // A pending or blocked account is reported as it is. Recreating it because
    // it is inconvenient is exactly how duplicate government identities happen.
    if (existing.accountStatus === 'verification_pending' || existing.accountStatus === 'registration_pending') {
      return settle({
        outcome: 'verification_pending',
        account: existing,
        scope,
        reason: existing.emailVerificationStatus === 'mailbox_unavailable'
          ? 'An account exists and is awaiting email verification through an approved LandOS mailbox.'
          : 'An account exists and is awaiting email verification.',
      });
    }
    if (existing.humanActionRequired || existing.accountStatus === 'human_action_required') {
      return settle({
        outcome: 'human_action_required',
        account: existing,
        scope,
        reason: existing.humanActionReason ?? 'The existing account needs operator action.',
      });
    }
    if (existing.accountStatus === 'recovery_required' || existing.accountStatus === 'session_expired') {
      const reused = await reuseActiveAccount(existing, target, scope, request, deps, now);
      return settle({ ...reused, account: reused.account ?? existing, scope });
    }
    return settle({
      outcome: 'blocked',
      account: existing,
      scope,
      reason: existing.failureReason ?? 'The existing account is not usable.',
    });
  }

  /* ── no account fits: create at most one ─────────────────────────────── */

  if (!request.registrar) {
    return settle({
      outcome: 'registration_unavailable',
      reason: 'This source requires an account and no registration adapter is available for it.',
    });
  }
  if (registration === 'registration_closed' || registration === 'unsupported_registration') {
    return settle({
      outcome: 'registration_unavailable',
      reason: registration === 'registration_closed'
        ? 'The source is not accepting new accounts.'
        : 'The source published no registration path this workflow can complete.',
    });
  }

  const scope = resolveAccountScope({
    target,
    providerLevelProven: request.providerLevelProven,
    jurisdictionLevelProven: request.jurisdictionLevelProven,
  });

  // The policy engine inside ensureAccess is the real gate: it re-inspects the
  // registration form itself and refuses anything paid, identity-verified,
  // CAPTCHA-gated, or legally material, whatever the page-level read said.
  const created = await deps.accounts.ensureAccess({
    siteDomain: target.deploymentDomain,
    governmentJurisdiction: request.target.jurisdiction,
    platform: target.providerFamily,
    purpose: request.purpose ?? 'Free public property-record research for a LandOS lead.',
    registrar: request.registrar,
    retryExistingAccess: request.retryExistingAccess,
  });

  const stamped = stampAccess(created.account, {
    target,
    scope,
    requirement,
    detection: request.detection,
    at: now(),
  });
  const account = deps.repository.save(stamped);

  return settle({
    outcome: registrationOutcome(created),
    account,
    scope,
    reason: created.policy?.reason ?? outcomeReason(created),
    registrationAttempted: true,
    capabilities: accessCapabilities({ requirement, registration, account }),
  });
}

/* ───────────────────────── reuse: session, then login ────────────────── */

async function reuseActiveAccount(
  account: ManagedGovernmentAccount,
  target: AccessTarget,
  scope: AccountScope,
  request: EnsurePublicRecordAccessRequest,
  deps: PublicRecordAccessDeps,
  now: () => string,
): Promise<Partial<PublicRecordAccessResult> & { outcome: PublicRecordAccessOutcome; reason: string }> {
  // A live session is cheaper than a login and gentler on the portal.
  const stored = deps.sessions.findFor(target);
  if (stored && !sessionExpired(stored, now()) && stored.accountId === account.accountId) {
    const confirmed = await confirmSession(stored, account, request, deps);
    if (confirmed) {
      return {
        outcome: 'session_reused',
        account,
        session: confirmed,
        reason: 'An authenticated session for this exact source was reused; no new login was performed.',
      };
    }
    deps.sessions.markExpired(stored.sessionId, now());
    deps.accounts.markSessionExpired(account.accountId);
  }

  if (!request.login) {
    return {
      outcome: 'account_reused',
      account,
      reason: 'An active account for this source is on file. No login adapter was supplied for this call.',
    };
  }
  if (!account.credentialHandle) {
    return {
      outcome: 'human_action_required',
      account: deps.accounts.markRecoveryRequired(account.accountId, 'The stored account has no credential reference.', true),
      reason: 'The stored account has no credential reference and cannot sign in.',
    };
  }

  let secret: string;
  try {
    secret = (await deps.vault.retrieve(account.credentialHandle)).value;
  } catch (error) {
    return {
      outcome: 'human_action_required',
      account: deps.accounts.markRecoveryRequired(
        account.accountId,
        redactAccountSecrets((error as Error)?.message ?? 'Credential vault unavailable.'),
        true,
      ),
      reason: 'The stored credential could not be read from the approved vault.',
    };
  }

  let result: PublicRecordLoginResult;
  try {
    result = await request.login.login({
      username: account.username,
      password: secret,
      loginUrl: account.loginUrl ?? request.detection.loginUrl ?? null,
    });
  } finally {
    // The plaintext lives only for the duration of the call above.
    secret = '';
  }

  if (result.status === 'authenticated') {
    const at = now();
    const stateHandle = await storeSessionMaterial(result.sessionMaterial, account, target, deps);
    const session = deps.sessions.save(newSession({
      accountId: account.accountId,
      target,
      accountScope: scope,
      establishedAt: at,
      expiresAt: result.expiresAt ?? null,
      stateHandle,
    }));
    return {
      outcome: 'account_reused',
      account: deps.accounts.recordLoginSuccess(account.accountId),
      session,
      reason: 'The existing account signed in and a reusable session was established.',
    };
  }

  // A login failure NEVER becomes a registration. It becomes a named state.
  if (result.status === 'locked') {
    return {
      outcome: 'human_action_required',
      account: deps.accounts.markRecoveryRequired(account.accountId, result.reason ?? 'The account is locked.', true),
      reason: 'The existing account is locked. No replacement account was created.',
    };
  }
  if (result.status === 'password_reset_required' || result.status === 'invalid_credentials') {
    return {
      outcome: 'human_action_required',
      account: deps.accounts.markRecoveryRequired(
        account.accountId,
        result.reason ?? (result.status === 'invalid_credentials'
          ? 'The stored credential was rejected.'
          : 'A password reset is required.'),
        true,
      ),
      reason: result.status === 'invalid_credentials'
        ? 'The stored credential was rejected. Recovery is required; no duplicate account was created.'
        : 'The portal requires a password reset. No duplicate account was created.',
    };
  }
  if (result.status === 'human_action_required') {
    return {
      outcome: 'human_action_required',
      account: deps.accounts.markRecoveryRequired(account.accountId, result.reason, true),
      reason: result.reason,
    };
  }
  return {
    outcome: 'login_failed',
    account: deps.accounts.markSessionExpired(account.accountId, result.reason),
    reason: redactAccountSecrets(result.reason),
  };
}

/** Confirms stored material still authenticates. Absent a `resume`, trust the metadata. */
async function confirmSession(
  session: PublicRecordSession,
  account: ManagedGovernmentAccount,
  request: EnsurePublicRecordAccessRequest,
  deps: PublicRecordAccessDeps,
): Promise<PublicRecordSession | null> {
  if (!request.login?.resume || !session.stateHandle) return session;
  try {
    const material = (await deps.vault.retrieve(session.stateHandle)).value;
    const check = await request.login.resume({
      sessionMaterial: material,
      loginUrl: account.loginUrl ?? request.detection.loginUrl ?? null,
    });
    return check.status === 'authenticated' ? session : null;
  } catch {
    return null;
  }
}

/** Authenticated material goes to the vault; only its handle reaches SQLite. */
async function storeSessionMaterial(
  material: string | undefined,
  account: ManagedGovernmentAccount,
  target: AccessTarget,
  deps: PublicRecordAccessDeps,
): Promise<string | null> {
  if (!material) return null;
  try {
    if (!(await deps.vault.isAvailable())) return null;
    const stored = await deps.vault.put({
      scope: `${target.deploymentDomain}/session/${account.accountId}`,
      password: material,
      kind: 'session_cookie',
    });
    return stored.credentialHandle || null;
  } catch {
    // A session that cannot be stored securely is simply not stored. The next
    // call logs in again, which is slower and completely safe.
    return null;
  }
}

/* ──────────────────────── operator manual override ───────────────────── */

export interface AttachOperatorAccountRequest {
  target: AccessTarget;
  username: string;
  /** A handle from the approved vault. A password is never accepted here. */
  credentialHandle: string;
  scope?: AccountScope;
  loginUrl?: string | null;
  notes?: string | null;
  purpose?: string;
}

/**
 * Associate an account the operator already holds, without creating a duplicate.
 *
 * Takes a vault handle, never a password: this path must not become a way for a
 * secret to arrive through an API body and land in a log.
 */
export function attachOperatorAccount(
  request: AttachOperatorAccountRequest,
  deps: Pick<PublicRecordAccessDeps, 'repository'> & { now?: () => string },
): ManagedGovernmentAccount {
  const now = deps.now ?? (() => new Date().toISOString());
  const at = now();
  const target = normalizeAccessTarget(request.target);
  const handle = String(request.credentialHandle ?? '').trim();
  if (!handle) throw new Error('An approved credential reference is required.');
  if (/\s/.test(handle) || handle.length > 200) throw new Error('The credential reference is not a vault handle.');

  const scope = request.scope ?? 'deployment';
  const existing = deps.repository.findReusable?.(target) ?? null;
  const base = existing ?? emptyAccount(target, at);

  return deps.repository.save({
    ...base,
    siteDomain: target.deploymentDomain,
    governmentJurisdiction: request.target.jurisdiction,
    platform: target.providerFamily,
    purpose: request.purpose ?? base.purpose ?? 'Operator-supplied free public-record account.',
    username: String(request.username ?? '').trim(),
    credentialHandle: handle,
    accountStatus: 'active',
    emailVerificationStatus: 'not_required',
    providerFamily: target.providerFamily,
    accountScope: scope,
    scopeKey: accountScopeKey(scope, target),
    loginUrl: request.loginUrl ?? base.loginUrl ?? null,
    authRequirement: 'auth_required',
    notes: request.notes ?? base.notes ?? null,
    operatorSupplied: true,
    failureReason: null,
    humanActionRequired: false,
    humanActionReason: null,
    lastVerifiedAt: at,
    updatedAt: at,
  });
}

/* ─────────────────────────────── helpers ─────────────────────────────── */

function stampAccess(
  account: ManagedGovernmentAccount,
  input: { target: AccessTarget; scope: AccountScope; requirement: AccessRequirement; detection: AuthDetection; at: string },
): ManagedGovernmentAccount {
  return {
    ...account,
    providerFamily: input.target.providerFamily,
    accountScope: input.scope,
    scopeKey: accountScopeKey(input.scope, input.target),
    loginUrl: input.detection.loginUrl ?? account.loginUrl ?? null,
    registrationUrl: input.detection.registrationUrl ?? account.registrationUrl ?? null,
    authRequirement: input.requirement,
    lastVerifiedAt: account.accountStatus === 'active' ? input.at : account.lastVerifiedAt ?? null,
    updatedAt: input.at,
  };
}

function registrationOutcome(result: EnsureGovernmentAccessResult): PublicRecordAccessOutcome {
  switch (result.outcome) {
    case 'created': return 'account_created';
    case 'reused': return 'account_reused';
    case 'verification_pending':
    case 'pending': return 'verification_pending';
    case 'human_action_required': return 'human_action_required';
    case 'failed':
    case 'blocked':
    default: return 'blocked';
  }
}

function outcomeReason(result: EnsureGovernmentAccessResult): string {
  switch (result.outcome) {
    case 'created': return 'A free public-record account was created and its credential stored in the approved vault.';
    case 'reused': return 'An existing account for this source was reused.';
    case 'verification_pending':
    case 'pending': return 'Registration completed and the account is awaiting email verification.';
    case 'human_action_required': return result.account.humanActionReason ?? 'Operator action is required.';
    default: return result.account.failureReason ?? 'Registration did not complete.';
  }
}

function emptyAccount(target: AccessTarget, at: string): ManagedGovernmentAccount {
  return {
    accountId: cryptoRandomId(),
    siteDomain: target.deploymentDomain,
    governmentJurisdiction: target.jurisdiction,
    platform: target.providerFamily,
    purpose: '',
    username: '',
    emailAliasReference: '',
    credentialHandle: '',
    accountStatus: 'active',
    emailVerificationStatus: 'not_required',
    createdAt: at,
    lastSuccessfulLogin: null,
    lastPasswordRotation: null,
    recoveryStatus: 'not_needed',
    termsVersion: null,
    registrationDate: null,
    failureReason: null,
    sessionState: 'none',
    humanActionRequired: false,
    humanActionReason: null,
    updatedAt: at,
  };
}

function cryptoRandomId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `landos-${Date.now().toString(36)}`;
}
