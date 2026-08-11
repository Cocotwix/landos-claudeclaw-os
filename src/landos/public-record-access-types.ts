// LandOS — free public-record ACCESS model.
//
// The GIS foundation can already find and read an official parcel source. Some
// official sources put their public search behind a free account. This module
// is the vocabulary for that: what a portal demands, whether a free account can
// be created at all, and — the part that actually protects the operator — how
// far one credential is allowed to travel.
//
// Scope is the whole safety story. A credential minted for one county portal
// must never be presented to a different county, and a credential minted for
// one vendor must never be presented to another vendor. That is enforced here,
// as data, rather than left to each caller to remember.
//
// Nothing in this file holds a password, a cookie, a verification code, or any
// property evidence. It holds requirements, scopes and references only.

/* ──────────────────────────── what a portal wants ─────────────────────── */

export const ACCESS_REQUIREMENTS = [
  /** Public search answered with no account at all. */
  'auth_not_required',
  /** A login exists, but the public search answered without it. */
  'auth_optional',
  /** The public search cannot be reached without an account. */
  'auth_required',
  /** Not yet observed. Never assume either direction. */
  'unknown',
] as const;
export type AccessRequirement = (typeof ACCESS_REQUIREMENTS)[number];

export const REGISTRATION_AVAILABILITIES = [
  /** No account is needed, so registration is not a question. */
  'not_applicable',
  /** A registration path exists and the source states it is free. */
  'free_registration_supported',
  /** A registration path exists but nothing proves it is free. */
  'free_registration_unproven',
  /** Money, credits, a subscription, or a payment method is in the way. */
  'paid_access_required',
  /** Registration exists but is closed to new accounts. */
  'registration_closed',
  /** No registration path this workflow can complete. */
  'unsupported_registration',
] as const;
export type RegistrationAvailability = (typeof REGISTRATION_AVAILABILITIES)[number];

/**
 * The capability handoff the nationwide zoning/subdivision sprint will read to
 * decide whether it may continue on its own. Deliberately coarse: it answers
 * "can automation proceed here", not "what happened on Tuesday".
 */
export const PUBLIC_RECORD_ACCESS_CAPABILITIES = [
  'AUTH_REQUIRED',
  'AUTH_OPTIONAL',
  'AUTH_NOT_REQUIRED',
  'FREE_REGISTRATION_SUPPORTED',
  'FREE_REGISTRATION_UNPROVEN',
  'PAID_ACCESS_REQUIRED',
  'LOGIN_ACCOUNT_AVAILABLE',
  'LOGIN_VERIFICATION_PENDING',
] as const;
export type PublicRecordAccessCapability = (typeof PUBLIC_RECORD_ACCESS_CAPABILITIES)[number];

/* ────────────────────────────── credential scope ──────────────────────── */

/**
 * How far one account reaches.
 *
 * Ordered narrow → broad. A broader scope is only ever assigned on evidence;
 * `deployment` is the default because guessing wide is the failure that leaks a
 * credential to a portal it was never issued for.
 */
export const ACCOUNT_SCOPES = ['deployment', 'jurisdiction', 'provider'] as const;
export type AccountScope = (typeof ACCOUNT_SCOPES)[number];

export function isAccountScope(value: unknown): value is AccountScope {
  return (ACCOUNT_SCOPES as readonly string[]).includes(String(value));
}

/** The thing a credential is being asked to unlock. */
export interface AccessTarget {
  /** The platform family, e.g. `arcgis`, `schneider`, `tyler`. Never a hostname. */
  providerFamily: string;
  /** The specific deployment host, e.g. `beacon.schneidercorp.com`. */
  deploymentDomain: string;
  /** The governing jurisdiction, e.g. `Fayette County, GA`. May be empty when unknown. */
  jurisdiction: string;
}

export function normalizeProviderFamily(value: string): string {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, '_') || 'unknown';
}

export function normalizeDeploymentDomain(value: string): string {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return '';
  try {
    return new URL(raw.includes('://') ? raw : `https://${raw}`).hostname.replace(/^www\./, '');
  } catch {
    return raw.replace(/^www\./, '').split('/')[0] ?? '';
  }
}

export function normalizeJurisdiction(value: string): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function normalizeAccessTarget(target: AccessTarget): AccessTarget {
  return {
    providerFamily: normalizeProviderFamily(target.providerFamily),
    deploymentDomain: normalizeDeploymentDomain(target.deploymentDomain),
    jurisdiction: normalizeJurisdiction(target.jurisdiction),
  };
}

/**
 * The canonical key a credential is filed under.
 *
 * The provider family is in EVERY key, at every scope. That is what stops a
 * jurisdiction-scoped account for one vendor from ever colliding with the same
 * jurisdiction on a different vendor.
 */
export function accountScopeKey(scope: AccountScope, target: AccessTarget): string {
  const t = normalizeAccessTarget(target);
  switch (scope) {
    case 'provider':
      return `provider:${t.providerFamily}`;
    case 'jurisdiction':
      return `jurisdiction:${t.providerFamily}|${t.jurisdiction}`;
    case 'deployment':
      return `deployment:${t.providerFamily}|${t.deploymentDomain}`;
  }
}

/** Every key a target could legitimately be served by, narrowest first. */
export function candidateScopeKeys(target: AccessTarget): Array<{ scope: AccountScope; scopeKey: string }> {
  const t = normalizeAccessTarget(target);
  const keys: Array<{ scope: AccountScope; scopeKey: string }> = [
    { scope: 'deployment', scopeKey: accountScopeKey('deployment', t) },
  ];
  // A jurisdiction key with no jurisdiction would match every unknown-jurisdiction
  // portal on the provider. That is exactly the leak this module exists to stop.
  if (t.jurisdiction) keys.push({ scope: 'jurisdiction', scopeKey: accountScopeKey('jurisdiction', t) });
  keys.push({ scope: 'provider', scopeKey: accountScopeKey('provider', t) });
  return keys;
}

/**
 * The isolation gate. Returns true only when an account filed at `scope`/`scopeKey`
 * is genuinely entitled to be presented to `target`.
 *
 * An account may only be used at ITS OWN scope. A deployment-scoped account is
 * never widened to its jurisdiction, and a jurisdiction-scoped account is never
 * widened to its provider, no matter how convenient that would be.
 */
export function credentialAppliesTo(
  account: { accountScope: AccountScope; scopeKey: string },
  target: AccessTarget,
): boolean {
  if (!isAccountScope(account.accountScope)) return false;
  const expected = accountScopeKey(account.accountScope, target);
  // A jurisdiction-scoped account cannot serve a target with no jurisdiction:
  // the key would degrade to a provider-wide wildcard.
  if (account.accountScope === 'jurisdiction' && !normalizeAccessTarget(target).jurisdiction) return false;
  if (account.accountScope === 'deployment' && !normalizeAccessTarget(target).deploymentDomain) return false;
  return account.scopeKey === expected;
}

/**
 * The scope a NEW account is filed under.
 *
 * Conservative by construction: `deployment` unless the provider is known to
 * operate a single shared account store across its deployments AND that has
 * actually been demonstrated. `providerLevelProven` is supplied by the caller
 * from real evidence, never inferred from branding.
 */
export function resolveAccountScope(input: {
  target: AccessTarget;
  providerLevelProven?: boolean;
  jurisdictionLevelProven?: boolean;
}): AccountScope {
  const t = normalizeAccessTarget(input.target);
  if (input.providerLevelProven) return 'provider';
  if (input.jurisdictionLevelProven && t.jurisdiction) return 'jurisdiction';
  return 'deployment';
}

/* ─────────────────────────────── labels ───────────────────────────────── */

export function accessRequirementLabel(requirement: AccessRequirement): string {
  switch (requirement) {
    case 'auth_not_required': return 'No login required';
    case 'auth_optional': return 'Login optional';
    case 'auth_required': return 'Free login required';
    case 'unknown': return 'Access requirement not observed';
  }
}

export function registrationAvailabilityLabel(availability: RegistrationAvailability): string {
  switch (availability) {
    case 'not_applicable': return 'Registration not needed';
    case 'free_registration_supported': return 'Free registration available';
    case 'free_registration_unproven': return 'Registration available, cost not stated';
    case 'paid_access_required': return 'Paid access required';
    case 'registration_closed': return 'Registration closed';
    case 'unsupported_registration': return 'Registration not automatable';
  }
}

export function accountScopeLabel(scope: AccountScope, target: AccessTarget): string {
  const t = normalizeAccessTarget(target);
  switch (scope) {
    case 'provider': return `${target.providerFamily} provider account`;
    case 'jurisdiction': return `${target.jurisdiction || t.jurisdiction} jurisdiction account`;
    case 'deployment': return `${t.deploymentDomain} deployment account`;
  }
}
