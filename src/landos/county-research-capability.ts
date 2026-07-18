/**
 * Shared county research memory and eligible public-access coordination.
 *
 * This is intentionally a narrow bridge between the real county workflow and
 * durable learning.  It recognizes the common portal family first, borrows
 * only value-free guidance from another proven county, and writes a county
 * override only after a real lookup yields evidenced facts.  Account creation
 * remains opt-in by adapter and is blocked before any paid, CAPTCHA, identity,
 * or material-terms path can be touched.
 */

import {
  CountyCapabilityRegistry,
  identifyCountyPlatformFamily,
  type CountyCapability,
  type CountyEvidenceProvenance,
  type CountyManagedAccountState,
  type CountyNavigationGuidance,
  type CountySearchMethod,
} from './county-capability-registry.js';
import {
  GovernmentAccountManager,
  type EnsureGovernmentAccessResult,
  type GovernmentRegistrationAdapter,
} from './government-account-manager.js';
import { EnvironmentManagedEmailProvider } from './managed-identity.js';
import { WindowsCredentialVault } from './windows-credential-vault.js';
import { SqliteGovernmentAccountRepository } from './government-account-manager.js';
import type { CountySourceLink } from './netr-routing.js';

export interface CountyPortalObservation {
  state: string;
  county: string;
  sources: CountySourceLink[];
  observedAt?: string;
  runReference: string;
}

export interface CountySuccessfulLookup {
  state: string;
  county: string;
  source: CountySourceLink;
  searchMethods: CountySearchMethod[];
  validatedFacts: string[];
  observedAt?: string;
  runReference: string;
}

export interface EnsureCountyPublicAccess {
  state: string;
  county: string;
  sourceUrl: string;
  sourceLabel: string;
  registrar: GovernmentRegistrationAdapter;
  purpose?: string;
  retryExistingAccess?: boolean;
}

export class CountyResearchCapability {
  constructor(
    private readonly registry = new CountyCapabilityRegistry(),
    private readonly accounts = new GovernmentAccountManager(
      new SqliteGovernmentAccountRepository(), new EnvironmentManagedEmailProvider(), new WindowsCredentialVault(),
    ),
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  /** Persist safe portal metadata as soon as local official sources are routed. */
  observeLocalSources(input: CountyPortalObservation): CountyCapability | null {
    const source = preferredPortalSource(input.sources);
    if (!source) return null;
    const evidence = sourceEvidence(source, input.observedAt ?? this.now(), input.runReference);
    return this.registry.upsert({
      state: input.state,
      county: input.county,
      officialGisUrl: findSource(input.sources, 'gis'),
      assessorUrl: findSource(input.sources, 'assessor') ?? findSource(input.sources, 'appraiser'),
      taxUrl: findSource(input.sources, 'tax'),
      recorderUrl: findSource(input.sources, 'recorder'),
      planningZoningUrl: findSource(input.sources, 'planning'),
      platformFamily: identifyCountyPlatformFamily({ url: source.url, title: source.label }),
      implementationStatus: 'observed_only',
      supportedSearchMethods: ['address', 'apn', 'owner'],
      loginRequirement: 'unknown',
      managedAccountState: 'none',
      captchaState: 'unknown',
      confidence: source.confidence >= 0.85 ? 'high' : 'medium',
      evidenceProvenance: [evidence],
    });
  }

  guidance(state: string, county: string): CountyNavigationGuidance {
    return this.registry.getNavigationGuidance(state, county);
  }

  /** A successful page may teach this county; it never promotes a family match alone. */
  recordSuccessfulLookup(input: CountySuccessfulLookup): void {
    const at = input.observedAt ?? this.now();
    const family = identifyCountyPlatformFamily({ url: input.source.url, title: input.source.label });
    const existing = this.registry.get(input.state, input.county);
    if (!existing) {
      this.observeLocalSources({
        state: input.state, county: input.county, sources: [input.source], observedAt: at, runReference: input.runReference,
      });
    }
    const current = this.registry.getUsableRecipe(input.state, input.county);
    if (current) {
      this.registry.recordRecipeSuccess(input.state, input.county, current.version, input.runReference, at);
      return;
    }
    const sourceEvidenceRow = sourceEvidence(input.source, at, input.runReference);
    this.registry.upsert({
      state: input.state, county: input.county, platformFamily: family, implementationStatus: 'live_tested',
      supportedSearchMethods: input.searchMethods, confidence: 'high', evidenceProvenance: [sourceEvidenceRow],
    });
    this.registry.recordVerifiedRecipe({
      state: input.state,
      county: input.county,
      platformFamily: family,
      searchMethods: input.searchMethods,
      steps: [
        { action: 'navigate', url: input.source.url, timeoutMs: 25_000 },
        { action: 'select_search_method', target: 'best available parcel identifier' },
        { action: 'fill_identifier', valueSource: input.searchMethods.find((method): method is 'address' | 'apn' | 'owner' => method === 'address' || method === 'apn' || method === 'owner') ?? 'address' },
        { action: 'submit' },
        { action: 'wait_for_results', expected: 'matching parcel record', timeoutMs: 25_000 },
        { action: 'select_result', target: 'matching parcel record' },
        { action: 'capture_evidence', target: 'visible official parcel facts' },
        { action: 'validate_fact', expected: input.validatedFacts.join(', ') },
      ],
      verification: {
        status: 'successful', verifiedAt: at, runReference: input.runReference,
        validatedFacts: input.validatedFacts, evidenceProvenance: [sourceEvidenceRow],
      },
    });
  }

  /**
   * Use only a supplied county/platform registration adapter.  The account
   * manager blocks all unqualified registrations before it fills any form, then
   * maps the safe lifecycle result back to the county capability for reuse.
   */
  async ensureEligibleFreeAccess(input: EnsureCountyPublicAccess): Promise<EnsureGovernmentAccessResult> {
    const url = new URL(input.sourceUrl);
    const observedAt = this.now();
    const family = identifyCountyPlatformFamily({ url: input.sourceUrl, title: input.sourceLabel });
    const evidence: CountyEvidenceProvenance = {
      sourceUrl: input.sourceUrl, sourceLabel: input.sourceLabel, observedAt,
      evidenceReference: `county-access/${cleanKey(input.state)}/${cleanKey(input.county)}`,
      classification: 'official',
    };
    this.registry.upsert({
      state: input.state, county: input.county, recorderUrl: input.sourceUrl, platformFamily: family,
      implementationStatus: 'observed_only', loginRequirement: 'account_required', managedAccountState: 'none',
      confidence: 'medium', evidenceProvenance: [evidence],
    });
    const result = await this.accounts.ensureAccess({
      siteDomain: url.hostname,
      governmentJurisdiction: `${input.county} County, ${input.state}`,
      platform: family,
      purpose: input.purpose ?? 'Free public property and recorded-document research for a LandOS lead.',
      registrar: input.registrar,
      retryExistingAccess: input.retryExistingAccess,
    });
    this.registry.upsert({
      state: input.state, county: input.county, managedAccountId: result.account.accountId,
      managedAccountState: accountState(result), evidenceProvenance: [evidence],
    });
    return result;
  }
}

function preferredPortalSource(sources: CountySourceLink[]): CountySourceLink | null {
  return sources.find((source) => source.type === 'gis')
    ?? sources.find((source) => source.type === 'assessor' || source.type === 'appraiser')
    ?? sources.find((source) => source.type === 'recorder')
    ?? sources[0]
    ?? null;
}
function findSource(sources: CountySourceLink[], type: CountySourceLink['type']): string | null {
  return sources.find((source) => source.type === type)?.url ?? null;
}
function sourceEvidence(source: CountySourceLink, observedAt: string, runReference: string): CountyEvidenceProvenance {
  return {
    sourceUrl: source.url, sourceLabel: source.label || `Official county ${source.type}`,
    observedAt, evidenceReference: runReference, classification: source.origin === 'netr' ? 'government_platform' : 'official',
  };
}
function accountState(result: EnsureGovernmentAccessResult): CountyManagedAccountState {
  if (result.outcome === 'created') return 'account_created';
  if (result.outcome === 'reused') return 'existing_managed_account';
  if (result.outcome === 'verification_pending' || result.outcome === 'pending') return 'verification_pending';
  if (result.outcome === 'human_action_required') return 'human_action_required';
  return 'access_blocked';
}
function cleanKey(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'unknown'; }
