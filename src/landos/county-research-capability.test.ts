import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { CountyCapabilityRegistry } from './county-capability-registry.js';
import { CountyResearchCapability } from './county-research-capability.js';
import type { GovernmentAccountManager } from './government-account-manager.js';

const NOW = '2026-07-18T16:00:00.000Z';
const source = { type: 'gis' as const, url: 'https://county.maps.arcgis.com/apps/viewer', label: 'County GIS', origin: 'netr' as const, confidence: 0.95 };

describe('CountyResearchCapability (unit)', () => {
  it('observes the platform, then promotes only a real fact-returning county lookup', () => {
    const db = new Database(':memory:');
    const registry = new CountyCapabilityRegistry(db, () => new Date(NOW));
    const capability = new CountyResearchCapability(registry, {} as GovernmentAccountManager, () => NOW);
    capability.observeLocalSources({ state: 'GA', county: 'Fayette', sources: [source], runReference: 'route/fayette' });
    expect(registry.get('GA', 'Fayette')).toMatchObject({ platformFamily: 'arcgis', implementationStatus: 'observed_only' });
    capability.recordSuccessfulLookup({
      state: 'GA', county: 'Fayette', source, searchMethods: ['apn'], validatedFacts: ['apn', 'owner'], runReference: 'lookup/fayette',
    });
    expect(registry.get('GA', 'Fayette')).toMatchObject({ implementationStatus: 'live_tested', currentRecipeVersion: 1 });
    expect(registry.getNavigationGuidance('GA', 'Fayette').kind).toBe('county_verified');
  });

  it('maps an eligible-account lifecycle outcome to safe county status without exposing a secret', async () => {
    const db = new Database(':memory:');
    const registry = new CountyCapabilityRegistry(db, () => new Date(NOW));
    const manager = {
      async ensureAccess() {
        return {
          outcome: 'created' as const,
          policy: null,
          account: {
            accountId: 'acct-fayette', siteDomain: 'records.fayettecountyga.gov', governmentJurisdiction: 'Fayette County, GA', platform: 'custom_county_portal', purpose: 'public records', username: 'safe-reference', emailAliasReference: 'alias/fayette', credentialHandle: 'landos-vault:opaque-handle', accountStatus: 'active' as const, emailVerificationStatus: 'not_required' as const, createdAt: NOW, lastSuccessfulLogin: NOW, lastPasswordRotation: NOW, recoveryStatus: 'not_needed' as const, termsVersion: null, registrationDate: NOW, failureReason: null, sessionState: 'authenticated' as const, humanActionRequired: false, humanActionReason: null, updatedAt: NOW,
          },
        };
      },
    } as unknown as GovernmentAccountManager;
    const capability = new CountyResearchCapability(registry, manager, () => NOW);
    const result = await capability.ensureEligibleFreeAccess({
      state: 'GA', county: 'Fayette', sourceUrl: 'https://records.fayettecountyga.gov/', sourceLabel: 'Fayette County Clerk', registrar: {} as never,
    });
    expect(result.outcome).toBe('created');
    expect(registry.get('GA', 'Fayette')).toMatchObject({ managedAccountId: 'acct-fayette', managedAccountState: 'account_created' });
    expect(JSON.stringify(registry.get('GA', 'Fayette'))).not.toMatch(/password|token|cookie|secret/i);
  });
});
