import { beforeEach, describe, expect, it } from 'vitest';

import { _initTestLandosDb } from './db.js';
import {
  GovernmentRecordAdapterRegistry,
  rememberSuccessfulGovernmentNavigation,
  type OfficialGovernmentSource,
} from './government-records-adapters.js';
import { getPlatformIntel } from './platform-library.js';
import type { GovernmentRecordCollectorAdapter } from './government-records-operator.js';
import type { PropertyIdentityVersion } from './property-summary-slice.js';

beforeEach(() => _initTestLandosDb());

const identity = {
  id: 9,
  dealCardId: 1,
  propertyCardId: 1,
  version: 1,
  status: 'confirmed',
  address: '100 Record Ln',
  city: 'Cleveland',
  county: 'White',
  state: 'GA',
  zip: '30528',
  apn: '001',
  owner: 'Owner',
  acreage: 10,
  geometry: { type: 'Polygon' },
  basis: 'official',
  confidence: 1,
  sourceRefs: [],
  changeReason: 'accepted',
  createdBy: 'test',
  isCurrent: true,
  createdAt: 1,
} satisfies PropertyIdentityVersion;

const source = (over: Partial<OfficialGovernmentSource> = {}): OfficialGovernmentSource => ({
  jurisdiction: 'White County, GA',
  authority: 'White County Recorder',
  url: 'https://records.whitecounty.example/search',
  sourceType: 'recorder',
  platformHint: 'Tyler Records',
  configuration: { searchMode: 'parcel' },
  ...over,
});

const adapter = (key: string, platform: string): GovernmentRecordCollectorAdapter => ({
  key,
  platform,
  async collect() { return { status: 'succeeded', claims: [], artifacts: [] }; },
});

describe('government-record platform adapter resolution', () => {
  it('resolves jurisdiction -> official source -> known reusable adapter -> jurisdiction configuration', () => {
    const registry = new GovernmentRecordAdapterRegistry().register({
      key: 'tyler-records-v1',
      platform: 'tyler-records',
      supports: (candidate) => candidate.platformHint === 'Tyler Records',
      create: () => adapter('tyler-records-v1', 'tyler-records'),
    });
    const resolved = registry.resolve({
      identity,
      domain: 'deed_ownership',
      officialSources: [source({ sourceType: 'assessor' }), source()],
      makeAdaptiveFallback: () => adapter('adaptive', 'adaptive'),
    });
    expect(resolved).toMatchObject({
      jurisdiction: 'White County, GA',
      adapterKey: 'tyler-records-v1',
      platform: 'tyler-records',
      resolution: 'known_adapter',
    });
    expect(resolved.source.configuration).toEqual({ searchMode: 'parcel' });
  });

  it('falls back to adaptive browser inspection for an unknown or changed platform', () => {
    const resolved = new GovernmentRecordAdapterRegistry().resolve({
      identity,
      domain: 'surveys_plats',
      officialSources: [source({ platformHint: 'Unknown 2026 redesign' })],
      makeAdaptiveFallback: () => adapter('adaptive-government-browser-v1', 'records.whitecounty.example'),
    });
    expect(resolved).toMatchObject({
      resolution: 'adaptive_browser_fallback',
      adapterKey: 'adaptive-government-browser-v1',
    });
  });

  it('records a successful value-free navigation pattern for later reuse', () => {
    rememberSuccessfulGovernmentNavigation({
      source: source(),
      domain: 'deed_ownership',
      adapterKey: 'tyler-records-v1',
      navigationPattern: 'parcel search -> results -> instrument image',
      authRequired: false,
    });
    const remembered = getPlatformIntel('records.whitecounty.example');
    expect(remembered?.navPatterns).toContain('parcel search -> results -> instrument image');
    expect(JSON.stringify(remembered)).not.toContain('100 Record Ln');
  });
});
