import { describe, expect, it, vi } from 'vitest';

import {
  MUNICIPAL_GIS_SOURCES,
  determinationFromGisEvidence,
  findMunicipalGisSource,
  runInteractiveGisZoning,
} from './interactive-gis-capability.js';
import type { GisBrowserExecutor, GisEvidence, GisSubject } from './interactive-gis-session.js';

const SUBJECT: GisSubject = {
  dealCardId: 89,
  apn: '042-123.00-000',
  address: '0 Kingwood Blvd, Fairview, TN 37062',
  municipality: 'Fairview',
  county: 'Williamson',
  state: 'TN',
  ownerName: 'LANDSOUTH LLC',
};

const FAIRVIEW = findMunicipalGisSource('Fairview', 'TN')!;

function evidence(overrides: Partial<GisEvidence> = {}): GisEvidence {
  return {
    question: 'current_zoning',
    appUrl: FAIRVIEW.appUrl,
    appTitle: 'Fairview Character Districts - Public',
    sourceLabel: FAIRVIEW.sourceLabel,
    layerUrl: FAIRVIEW.parcelLayerUrl,
    layerName: 'Parcels',
    layerLastEditedAt: '2026-08-13T13:26:42.897Z',
    subject: {
      confirmed: true,
      basis: 'parcel_identifier_owner_corroborated',
      observedIdentifier: '042    12300 00001042',
      observedOwner: 'LANDSOUTH LLC',
      statement: 'identifier matched and owner agrees',
    },
    derivation: 'layer_attribute',
    attribute: 'CD',
    value: 'CD-3L',
    legendLabel: 'CD-3L',
    screenshots: [{
      path: 'store/browser-shots/deal89-gis.png',
      purpose: 'current_zoning — subject with Parcels',
      layersVisible: ['Parcels'],
      legendCaptured: true,
      capturedAtIso: '2026-08-23T03:38:01.605Z',
    }],
    retrievedAtIso: '2026-08-23T03:38:01.605Z',
    notes: [],
    ...overrides,
  };
}

describe('the municipal GIS source registry', () => {
  it('records Fairview as data, pointing at the April 2026 adoption map', () => {
    expect(FAIRVIEW.regimeAdoptedAt).toBe('2026-04-02T00:00:00.000Z');
    expect(FAIRVIEW.parcelLayerUrl).toContain('NZM_Test_2/FeatureServer/31');
    expect(FAIRVIEW.appUrl).toContain('fairviewtn.maps.arcgis.com');
  });

  it('matches on municipality and state, case-insensitively', () => {
    expect(findMunicipalGisSource('fairview', 'tn')?.municipality).toBe('Fairview');
    expect(findMunicipalGisSource('Fairview', 'GA')).toBeNull();
    expect(findMunicipalGisSource(null, 'TN')).toBeNull();
  });

  it('every registered source carries the adoption date its currency check needs', () => {
    for (const source of MUNICIPAL_GIS_SOURCES) {
      expect(source.regimeAdoptedAt).toBeTruthy();
      expect(source.parcelLayerUrl).toMatch(/^https:\/\//);
    }
  });
});

describe('admitting a GIS reading as a zoning determination', () => {
  it('writes a confirmed determination from a current, identity-confirmed reading', () => {
    const determination = determinationFromGisEvidence({
      dealCardId: 89, evidence: evidence(), source: FAIRVIEW, now: () => '2026-08-23T00:00:00.000Z',
    })!;
    expect(determination.established).toBe(true);
    expect(determination.districtCode).toBe('CD-3L');
    expect(determination.confidence).toBe('confirmed');
    expect(determination.evidenceKind).toBe('parcel_zoning_gis');
    expect(determination.effectiveOrAsOf).toBe('2026-04-02T00:00:00.000Z');
    expect(determination.limitations.join(' ')).toMatch(/at or after the 2026-04-02/);
  });

  it('writes nothing when the layer predates the governing regime', () => {
    const determination = determinationFromGisEvidence({
      dealCardId: 89,
      // The city's previous public zoning layer: official, and superseded.
      evidence: evidence({ layerLastEditedAt: '2026-03-16T21:31:02.890Z', value: 'R20' }),
      source: FAIRVIEW,
    });
    expect(determination).toBeNull();
  });

  it('writes nothing when identity was not confirmed', () => {
    const determination = determinationFromGisEvidence({
      dealCardId: 89,
      evidence: evidence({
        subject: {
          confirmed: false, basis: 'unconfirmed', observedIdentifier: '042 12310',
          observedOwner: 'DUKE & DUKE LLC', statement: 'wrong parcel',
        },
      }),
      source: FAIRVIEW,
    });
    expect(determination).toBeNull();
  });

  it('notes an answer retained without a screenshot rather than hiding it', () => {
    const determination = determinationFromGisEvidence({
      dealCardId: 89, evidence: evidence({ screenshots: [] }), source: FAIRVIEW,
    })!;
    expect(determination.limitations.join(' ')).toMatch(/No screenshot of the map was retained/);
  });
});

describe('running the zoning question for a subject', () => {
  it('reports honestly when no official map is registered for the jurisdiction', async () => {
    const result = await runInteractiveGisZoning({
      subject: { ...SUBJECT, municipality: 'Nowhere', state: 'ZZ' },
      executor: {} as GisBrowserExecutor,
    });
    expect(result.determination).toBeNull();
    expect(result.notes.join(' ')).toMatch(/No official interactive zoning map is registered/);
  });

  it('keeps only screenshots that prove the layer they are offered for', async () => {
    const executor: GisBrowserExecutor = {
      id: 'test',
      openApp: vi.fn(async () => ({ url: FAIRVIEW.appUrl, title: 'Fairview Character Districts - Public' })),
      locateSubject: vi.fn(async () => ({
        identifier: '042    12300 00001042', owner: 'LANDSOUTH LLC', attributes: { CD: 'CD-3L' },
      })),
      listLayers: vi.fn(async () => [{
        id: 'p', title: 'Parcels', groupTitle: 'Fairview Public Zoning',
        url: FAIRVIEW.parcelLayerUrl, rendererField: 'CD', lastEditedAt: '2026-08-13T13:26:42.897Z',
      }]),
      setLayerVisible: vi.fn(async () => true),
      readSubjectAttributes: vi.fn(async () => ({ CD: 'CD-3L' })),
      readLegend: vi.fn(async () => [{ value: 'CD-3L', label: 'CD-3L' }]),
      // A capture that records no visible layer cannot prove the reading.
      capture: vi.fn(async (purpose: string) => ({
        path: 'store/browser-shots/x.png', purpose, layersVisible: [],
        legendCaptured: false, capturedAtIso: 'now',
      })),
    };

    const result = await runInteractiveGisZoning({ subject: SUBJECT, executor, source: FAIRVIEW });
    expect(result.session.outcome).toBe('answered');
    expect(result.determination?.districtCode).toBe('CD-3L');
    expect(result.provingScreenshots).toEqual([]);
  });
});
