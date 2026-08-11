// LandOS — the operator's four lines about access.
//
// The operator needs to know whether a source is open, whether LandOS holds a
// working account for it, how far that account reaches, and what — if anything
// — they personally have to do. Nothing else belongs on this surface.
//
// Deliberately absent, and enforced by `assertNoCredentialExposure`: passwords,
// vault handles, cookies, email addresses, usernames. A panel that leaks a
// credential reference into a screenshot has undone the vault.

import {
  accessRequirementLabel,
  normalizeAccessTarget,
  registrationAvailabilityLabel,
  type AccessRequirement,
  type AccountScope,
  type PublicRecordAccessCapability,
  type RegistrationAvailability,
} from './public-record-access-types.js';
import { PublicRecordAccessStore, type DeploymentAccessKnowledge } from './public-record-access-store.js';
import { accessCapabilities } from './public-record-access.js';
import {
  SqliteGovernmentAccountRepository,
  type GovernmentAccountRepository,
  type ManagedGovernmentAccount,
} from './government-account-manager.js';

export interface PublicRecordAccessView {
  /** False when this source's access requirement has never been observed. */
  present: boolean;
  requirement: AccessRequirement;
  accessLabel: string;
  registration: RegistrationAvailability;
  registrationLabel: string | null;
  /** Null when LandOS holds no account, which is the normal open-source case. */
  accountLabel: string | null;
  scopeLabel: string | null;
  lastLogin: string | null;
  /** The one thing the operator must do, or null when nothing is needed. */
  actionLabel: string | null;
  /** Set when a free login still fronts paid documents. */
  paidRecordsNote: string | null;
  capabilities: PublicRecordAccessCapability[];
  observedAt: string | null;
}

export function emptyPublicRecordAccessView(): PublicRecordAccessView {
  return {
    present: false,
    requirement: 'unknown',
    accessLabel: accessRequirementLabel('unknown'),
    registration: 'not_applicable',
    registrationLabel: null,
    accountLabel: null,
    scopeLabel: null,
    lastLogin: null,
    actionLabel: null,
    paidRecordsNote: null,
    capabilities: [],
    observedAt: null,
  };
}

function accountLabelFor(account: ManagedGovernmentAccount): string {
  switch (account.accountStatus) {
    case 'active': return account.operatorSupplied ? 'Active (operator supplied)' : 'Active';
    case 'verification_pending': return 'Verification pending';
    case 'registration_pending': return 'Registration in progress';
    case 'session_expired': return 'Session expired';
    case 'recovery_required': return 'Recovery required';
    case 'human_action_required': return 'Needs operator';
    case 'blocked': return 'Blocked';
    case 'suspended': return 'Suspended';
    case 'retired': return 'Retired';
    case 'not_registered': return 'Not registered';
  }
}

function actionLabelFor(
  account: ManagedGovernmentAccount | null,
  knowledge: DeploymentAccessKnowledge,
): string | null {
  if (knowledge.registration === 'paid_access_required') return 'Operator approval required for paid access';
  if (!account) {
    if (knowledge.requirement !== 'auth_required') return null;
    if (knowledge.registration === 'registration_closed') return 'Source is not accepting new accounts';
    if (knowledge.registration === 'unsupported_registration') return 'Registration cannot be completed automatically';
    return 'Free account not yet created';
  }
  if (account.accountStatus === 'verification_pending') {
    return account.emailVerificationStatus === 'mailbox_unavailable'
      ? 'Verify the account email from an approved LandOS mailbox'
      : 'Verify email';
  }
  if (account.humanActionRequired) return account.humanActionReason ?? 'Operator action required';
  if (account.accountStatus === 'recovery_required') return 'Account recovery required';
  if (account.accountStatus === 'session_expired') return 'Sign-in will be retried on next research run';
  if (account.accountStatus === 'blocked') return account.failureReason ?? 'Access blocked';
  return null;
}

function scopeLabelFor(account: ManagedGovernmentAccount): string {
  const scope = (account.accountScope ?? 'deployment') as AccountScope;
  switch (scope) {
    case 'provider': return `${account.providerFamily || account.platform} provider-wide`;
    case 'jurisdiction': return `${account.governmentJurisdiction || 'Jurisdiction'} only`;
    case 'deployment': return `${account.siteDomain} deployment only`;
  }
}

export function toPublicRecordAccessView(
  knowledge: DeploymentAccessKnowledge,
  account: ManagedGovernmentAccount | null,
): PublicRecordAccessView {
  const view: PublicRecordAccessView = {
    present: true,
    requirement: knowledge.requirement,
    accessLabel: knowledge.registration === 'paid_access_required'
      ? 'Paid access required'
      : accessRequirementLabel(knowledge.requirement),
    registration: knowledge.registration,
    registrationLabel: knowledge.requirement === 'auth_required' || knowledge.registration === 'paid_access_required'
      ? registrationAvailabilityLabel(knowledge.registration)
      : null,
    accountLabel: account ? accountLabelFor(account) : null,
    scopeLabel: account ? scopeLabelFor(account) : null,
    lastLogin: account?.lastSuccessfulLogin ?? null,
    actionLabel: actionLabelFor(account, knowledge),
    paidRecordsNote: knowledge.paidRecordsObserved
      ? 'This source offers paid documents. Searching is free; ordering a copy needs operator approval.'
      : null,
    capabilities: accessCapabilities({
      requirement: knowledge.requirement,
      registration: knowledge.registration,
      account,
    }),
    observedAt: knowledge.lastObservedAt,
  };
  assertNoCredentialExposure(view);
  return view;
}

/**
 * The invariant the panel depends on. Called on every build, so a future field
 * that carries a handle or an address fails here rather than on a screenshot.
 */
export function assertNoCredentialExposure(view: PublicRecordAccessView): void {
  const serialized = JSON.stringify(view);
  if (/landos-vault:|vault:\/\/|credentialHandle|stateHandle/i.test(serialized)) {
    throw new Error('The access panel must not expose a credential reference.');
  }
  if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(serialized)) {
    throw new Error('The access panel must not expose an account email address.');
  }
  if (/\bpassword\b/i.test(serialized)) {
    throw new Error('The access panel must not mention a password.');
  }
}

/**
 * The panel's access block for one official source URL.
 *
 * Read-only and keyed on the host, so it can be built for a Deal Card without
 * that card's identity ever reaching the shared access tables.
 */
export function buildPublicRecordAccessView(
  sourceUrl: string | null,
  deps: {
    store?: PublicRecordAccessStore;
    repository?: GovernmentAccountRepository;
  } = {},
): PublicRecordAccessView {
  if (!sourceUrl) return emptyPublicRecordAccessView();
  const host = normalizeAccessTarget({ providerFamily: '', deploymentDomain: sourceUrl, jurisdiction: '' }).deploymentDomain;
  if (!host) return emptyPublicRecordAccessView();

  const store = deps.store ?? new PublicRecordAccessStore();
  const knowledge = store.getByDomain(host);
  if (!knowledge) return emptyPublicRecordAccessView();

  const repository = deps.repository ?? new SqliteGovernmentAccountRepository();
  const account = repository.findReusable?.({
    providerFamily: knowledge.providerFamily,
    deploymentDomain: knowledge.deploymentDomain,
    jurisdiction: '',
  }) ?? null;

  return toPublicRecordAccessView(knowledge, account);
}
