import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import {
  CountyCapabilityRegistry, identifyCountyPlatformFamily,
  type CountyEvidenceProvenance, type VerifiedRecipeInput,
} from './county-capability-registry.js';

const NOW = new Date('2026-07-12T18:00:00Z');
const evidence: CountyEvidenceProvenance[] = [{
  sourceUrl: 'https://www.monroetn.gov/gis', sourceLabel: 'Official county GIS directory',
  observedAt: '2026-07-12T17:00:00Z', evidenceReference: 'county-discovery/run-1', classification: 'official',
}];
function setup(staleAfterFailures = 2) {
  const db = new Database(':memory:');
  return { db, registry: new CountyCapabilityRegistry(db, () => NOW, staleAfterFailures) };
}
function seed(registry: CountyCapabilityRegistry) {
  return registry.upsert({
    state: 'tn', county: 'Monroe County', officialGisUrl: 'https://www.monroetn.gov/gis',
    assessorUrl: 'https://www.monroetn.gov/assessor', taxUrl: 'https://www.monroetn.gov/tax',
    recorderUrl: 'https://www.monroetn.gov/register-of-deeds', planningZoningUrl: 'https://www.monroetn.gov/planning',
    platformFamily: 'arcgis', implementationStatus: 'fixture_tested', supportedSearchMethods: ['address', 'apn', 'owner'],
    loginRequirement: 'public', managedAccountState: 'none', captchaState: 'none_observed',
    availableLayers: ['Parcels', 'Road centerlines', 'Zoning'], confidence: 'medium', evidenceProvenance: evidence,
  });
}
function recipe(over: Partial<VerifiedRecipeInput> = {}): VerifiedRecipeInput {
  return {
    state: 'TN', county: 'Monroe', platformFamily: 'arcgis', searchMethods: ['address', 'apn'],
    steps: [
      { action: 'navigate', url: 'https://www.monroetn.gov/gis', timeoutMs: 10_000 },
      { action: 'select_search_method', target: 'Address' },
      { action: 'fill_identifier', target: '#search', valueSource: 'address' },
      { action: 'submit', target: '#submit' },
      { action: 'wait_for_results', expected: 'Parcel results', timeoutMs: 20_000 },
      { action: 'capture_evidence', target: 'selected parcel' },
      { action: 'validate_fact', expected: 'APN and situs address agree' },
    ],
    verification: {
      status: 'successful', verifiedAt: '2026-07-12T17:30:00Z', runReference: 'county-run/verified-1',
      validatedFacts: ['apn', 'situs_address'], evidenceProvenance: evidence,
    },
    ...over,
  };
}

describe('CountyCapabilityRegistry (fixture contract)', () => {
  it('persists the full capability without claiming untested live support', () => {
    const { db, registry } = setup();
    expect(seed(registry)).toMatchObject({
      state: 'TN', county: 'Monroe', platformFamily: 'arcgis', implementationStatus: 'fixture_tested',
      supportedSearchMethods: ['address', 'apn', 'owner'], loginRequirement: 'public', currentRecipeVersion: null,
    });
    expect(new CountyCapabilityRegistry(db).get('tn', 'Monroe County')?.availableLayers).toContain('Zoning');
  });
  it('publishes and versions recipes only after evidenced fact validation', () => {
    const { registry } = setup(); seed(registry);
    const v1 = registry.recordVerifiedRecipe(recipe());
    const v2 = registry.recordVerifiedRecipe(recipe({
      verification: {
        status: 'successful', verifiedAt: '2026-07-12T17:45:00Z', runReference: 'county-run/verified-2',
        validatedFacts: ['apn'], evidenceProvenance: evidence,
      },
    }));
    expect([v1.version, v2.version]).toEqual([1, 2]);
    expect(registry.recipeHistory('TN', 'Monroe').map((item) => [item.version, item.status]))
      .toEqual([[2, 'current'], [1, 'superseded']]);
    expect(registry.get('TN', 'Monroe')?.currentRecipeVersion).toBe(2);
  });
  it('rejects unsuccessful, unvalidated, and secret-bearing recipes', () => {
    const { registry } = setup(); seed(registry);
    expect(() => registry.recordVerifiedRecipe(recipe({
      verification: { status: 'successful', verifiedAt: NOW.toISOString(), runReference: 'x', validatedFacts: [], evidenceProvenance: evidence },
    }))).toThrow(/validate at least one/i);
    expect(() => registry.recordVerifiedRecipe(recipe({
      verification: { status: 'failed', verifiedAt: NOW.toISOString(), runReference: 'x', validatedFacts: ['apn'], evidenceProvenance: evidence },
    } as unknown as VerifiedRecipeInput))).toThrow(/successfully verified/i);
    expect(() => registry.recordVerifiedRecipe(recipe({
      steps: [{ action: 'navigate', url: 'https://county.gov/search?token=do-not-store' }],
    }))).toThrow(/credentials|secrets|query parameters/i);
    expect(() => registry.recordVerifiedRecipe(recipe({
      steps: [{ action: 'fill_identifier', target: '#password', valueSource: 'address' }],
    }))).toThrow(/credentials|secrets/i);
  });
  it('stales repeatedly failing, structurally changed, and age-expired recipes', () => {
    const { registry } = setup(2); seed(registry);
    const first = registry.recordVerifiedRecipe(recipe());
    expect(registry.recordRecipeFailure('TN', 'Monroe', first.version, 'No parcel rows.').status).toBe('current');
    expect(registry.recordRecipeFailure('TN', 'Monroe', first.version, 'Layout changed.')).toMatchObject({
      status: 'stale', consecutiveFailures: 2,
    });
    expect(registry.getUsableRecipe('TN', 'Monroe')).toBeNull();
    const second = registry.recordVerifiedRecipe(recipe({
      verification: {
        status: 'successful', verifiedAt: '2026-01-01T00:00:00Z', runReference: 'county-run/old',
        validatedFacts: ['apn'], evidenceProvenance: evidence,
      },
    }));
    expect(registry.getUsableRecipe('TN', 'Monroe', { maxAgeDays: 90, now: NOW })).toBeNull();
    expect(registry.getRecipe('TN', 'Monroe', second.version)?.status).toBe('stale');
  });
  it('recovers failure state only after a verified successful run', () => {
    const { registry } = setup(3); seed(registry);
    const current = registry.recordVerifiedRecipe(recipe());
    registry.recordRecipeFailure('TN', 'Monroe', current.version, 'Temporary timeout.');
    expect(registry.recordRecipeSuccess('TN', 'Monroe', current.version, 'county-run/recovered')).toMatchObject({
      status: 'current', consecutiveFailures: 0, lastFailureReason: null,
    });
    expect(registry.get('TN', 'Monroe')?.lastSuccessfulRun).toBe('county-run/recovered');
  });
});

describe('county platform-family classifier (unit)', () => {
  it.each([
    ['https://county.maps.arcgis.com/apps/experiencebuilder', 'arcgis'],
    ['https://beacon.schneidercorp.com/Application.aspx', 'schneider_beacon'],
    ['https://qpublic.net/ga/example', 'qpublic'],
    ['https://gis.vgsi.com/example', 'vision_government_solutions'],
    ['https://example.tylertech.com/eagleweb', 'tyler_technologies'],
    ['https://example.mapgeo.io', 'mapgeo'],
    ['https://example.patriotproperties.com', 'patriot_properties'],
    ['https://assessor.examplecounty.gov/search', 'custom_county_portal'],
    ['https://records.example.test', 'unknown'],
  ])('classifies %s as %s without making a support claim', (url, family) => {
    expect(identifyCountyPlatformFamily({ url })).toBe(family);
  });
});

