// The zoning header must not contradict the zoning body.
//
// Two stores answer "what is this parcel zoned", written by different lanes.
// On Deal 89 the panel showed a CONFIRMED CD-3L district in its body under a
// header chip reading "Zoning unverified", because the older whole-panel
// record had not been re-run since the interactive GIS session established the
// district.

import { describe, expect, it } from 'vitest';

import { emptyLandUseView, reconcileZoningPresence } from './land-use-view.js';
import type { CurrentZoningDetermination } from './current-zoning-determination.js';
import { emptyZoningStandards } from './current-zoning-determination.js';

function determination(overrides: Partial<CurrentZoningDetermination> = {}): CurrentZoningDetermination {
  return {
    dealCardId: 89,
    established: true,
    districtCode: 'CD-3L',
    districtName: 'CD-3L',
    overlays: [],
    authorityName: 'City of Fairview official zoning map (Fairview Character Districts - Public)',
    authorityDetermination: 'confirmed',
    evidenceKind: 'parcel_zoning_gis',
    sourceLabel: 'City of Fairview official zoning map (Fairview Character Districts - Public)',
    sourceUrl: 'https://fairviewtn.maps.arcgis.com/apps/mapviewer/index.html?webmap=11d597029c074ceb8aba8a8d0c983e21',
    parcelMatchBasis: 'parcel identifier 042 12300 with owner LANDSOUTH LLC corroborating',
    effectiveOrAsOf: '2026-04-02T00:00:00.000Z',
    verifiedAt: '2026-08-23T03:38:01.605Z',
    confidence: 'confirmed',
    conflicts: [],
    historicalReferences: [],
    requestedZoning: [],
    standards: emptyZoningStandards(),
    limitations: [],
    consideredEvidence: [],
    ...overrides,
  };
}

describe('zoning presence reconciliation', () => {
  it('promotes an unverified header once a current district is established', () => {
    const before = emptyLandUseView();
    expect(before.zoning.presence).toBe('zoning_unverified');

    const after = reconcileZoningPresence(before, determination());
    expect(after.zoning.presence).toBe('zoning_established');
    expect(after.zoning.presenceLabel).toBe('Zoning established');
    expect(after.zoning.code.value).toBe('CD-3L');
    expect(after.zoning.districtName.value).toBe('CD-3L');
    expect(after.present).toBe(true);
  });

  it('carries the authority and the official source behind the promotion', () => {
    const after = reconcileZoningPresence(emptyLandUseView(), determination());
    expect(after.zoning.governingAuthority).toMatch(/City of Fairview/);
    expect(after.zoning.code.sources).toHaveLength(1);
    expect(after.zoning.code.sources[0].url).toContain('fairviewtn.maps.arcgis.com');
    expect(after.zoning.code.sources[0].isPrimary).toBe(true);
    expect(after.zoning.code.sources[0].effectiveDate).toBe('2026-04-02T00:00:00.000Z');
    expect(after.zoning.code.sources[0].excerpt).toMatch(/042 12300/);
  });

  it('maps determination confidence onto the panel scale instead of widening it', () => {
    const confirmed = reconcileZoningPresence(emptyLandUseView(), determination());
    expect(confirmed.zoning.code.quality).toBe('verified_official');

    const likely = reconcileZoningPresence(emptyLandUseView(), determination({ confidence: 'likely' }));
    expect(likely.zoning.code.quality).toBe('provisional_official');
  });

  it('changes nothing when no current district is established', () => {
    const before = emptyLandUseView();
    expect(reconcileZoningPresence(before, null)).toBe(before);
    expect(reconcileZoningPresence(before, determination({ established: false }))).toBe(before);
    expect(reconcileZoningPresence(before, determination({ districtCode: null }))).toBe(before);
  });

  it('leaves an already-established header alone rather than overwriting it', () => {
    const established = reconcileZoningPresence(emptyLandUseView(), determination());
    const again = reconcileZoningPresence(established, determination({ districtCode: 'CD-9Z' }));
    // Idempotent: the panel's own established reading is not replaced by a
    // second pass of this correction.
    expect(again).toBe(established);
    expect(again.zoning.code.value).toBe('CD-3L');
  });
});
