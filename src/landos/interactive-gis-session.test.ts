// Governed interactive GIS research — the rules that make a map reading
// admissible, exercised against the real Fairview facts.

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  assessZoningCurrency,
  confirmGisSubject,
  runInteractiveGisSession,
  screenshotProves,
  selectLayersForQuestion,
  type GisBrowserExecutor,
  type GisLayerRef,
  type GisSubject,
} from './interactive-gis-session.js';
import { firstFieldValue, framedAppUrl } from './arcgis-interactive-executor.js';
import { laneOutcome, tallyResearchLanes } from './research-lane-outcome.js';
import {
  buildUtilityInfrastructureFinding,
  establishesServiceEntitlement,
} from './utility-infrastructure-relationship.js';

/** Deal 89 — 0 Kingwood Blvd, Fairview TN. */
const SUBJECT: GisSubject = {
  dealCardId: 89,
  apn: '042-123.00-000',
  address: '0 Kingwood Blvd, Fairview, TN 37062',
  municipality: 'Fairview',
  county: 'Williamson',
  state: 'TN',
  ownerName: 'LANDSOUTH LLC',
};

/** The City of Fairview zoning map published for the April 2, 2026 adoption. */
const CURRENT_LAYER: GisLayerRef = {
  id: 'NZM_Test_2/31',
  title: 'Parcels',
  groupTitle: 'Fairview Public Zoning',
  url: 'https://services6.arcgis.com/sCdesv1knCIWF2x3/arcgis/rest/services/NZM_Test_2/FeatureServer/31',
  rendererField: 'CD',
  lastEditedAt: '2026-08-13T13:26:42.897Z',
};

/** The city's PREVIOUS public zoning layer — official, and out of date. */
const SUPERSEDED_LAYER: GisLayerRef = {
  id: 'Fairview_Zoning_Public/0',
  title: 'Fairview Zoning',
  groupTitle: 'Fairview Public Zoning',
  url: 'https://services6.arcgis.com/sCdesv1knCIWF2x3/arcgis/rest/services/Fairview_Zoning_Public/FeatureServer/0',
  rendererField: 'Zoning',
  lastEditedAt: '2026-03-16T21:31:02.890Z',
};

const REGIME_ADOPTED = '2026-04-02T00:00:00.000Z';

function executor(overrides: Partial<GisBrowserExecutor> = {}): GisBrowserExecutor {
  return {
    id: 'test',
    openApp: vi.fn(async () => ({ url: 'https://fairviewtn.maps.arcgis.com/apps/mapviewer/index.html', title: 'Fairview Character Districts - Public' })),
    locateSubject: vi.fn(async () => ({
      identifier: '042    12300 00001042',
      owner: 'LANDSOUTH LLC',
      attributes: { CD: 'CD-3L', parcel_id: '042    12300 00001042', OwnerName1: 'LANDSOUTH LLC' },
    })),
    listLayers: vi.fn(async () => [CURRENT_LAYER]),
    setLayerVisible: vi.fn(async () => true),
    readSubjectAttributes: vi.fn(async () => ({ CD: 'CD-3L', parcel_id: '042    12300 00001042' })),
    readLegend: vi.fn(async () => [{ value: 'CD-3L', label: 'CD-3L' }, { value: 'POD', label: 'POD' }]),
    capture: vi.fn(async (purpose: string, layersVisible: string[]) => ({
      path: 'store/browser-shots/gis-zoning.png',
      purpose,
      layersVisible,
      legendCaptured: true,
      capturedAtIso: '2026-08-22T00:00:00.000Z',
    })),
    ...overrides,
  };
}

describe('identity is confirmed before any layer is read', () => {
  // Test 1.
  it('reads no layer until the map feature is proven to be the subject', async () => {
    const readSubjectAttributes = vi.fn(async () => ({ CD: 'CD-3L' }));
    const listLayers = vi.fn(async () => [CURRENT_LAYER]);
    const result = await runInteractiveGisSession({
      subject: SUBJECT,
      question: 'current_zoning',
      appUrl: 'https://example.gov/map',
      sourceLabel: 'City of Fairview',
      regimeAdoptedAt: REGIME_ADOPTED,
      executor: executor({
        locateSubject: vi.fn(async () => ({ identifier: null, owner: null, attributes: {} })),
        listLayers,
        readSubjectAttributes,
      }),
    });

    expect(result.outcome).toBe('subject_unconfirmed');
    expect(listLayers).not.toHaveBeenCalled();
    expect(readSubjectAttributes).not.toHaveBeenCalled();
    expect(result.evidence).toBeNull();
    expect(result.notes.join(' ')).toMatch(/Position on the map never establishes parcel identity/);
  });

  // Test 2 — the live hazard: the subject's bounding-box centre falls inside a
  // NEIGHBOURING parcel (DUKE & DUKE LLC), so a map read aimed there would
  // describe the wrong property.
  it('refuses a neighbouring parcel as evidence for the subject', async () => {
    const confirmation = confirmGisSubject({
      subject: SUBJECT,
      featureIdentifier: '042    12310 00001042',
      featureOwner: 'DUKE & DUKE LLC',
    });
    expect(confirmation.confirmed).toBe(false);
    expect(confirmation.basis).toBe('unconfirmed');
    expect(confirmation.statement).toMatch(/is not the subject parcel/);

    const result = await runInteractiveGisSession({
      subject: SUBJECT,
      question: 'current_zoning',
      appUrl: 'https://example.gov/map',
      sourceLabel: 'City of Fairview',
      executor: executor({
        locateSubject: vi.fn(async () => ({
          identifier: '042    12310 00001042', owner: 'DUKE & DUKE LLC', attributes: { CD: 'CD-3L' },
        })),
      }),
    });
    // The neighbour is ALSO CD-3L, so a careless read would have produced the
    // right-looking answer from the wrong parcel.
    expect(result.outcome).toBe('subject_unconfirmed');
    expect(result.evidence).toBeNull();
  });

  it('accepts the subject on its parcel identifier and records owner corroboration', () => {
    const confirmation = confirmGisSubject({
      subject: SUBJECT,
      featureIdentifier: '042    12300 00001042',
      featureOwner: 'LANDSOUTH LLC',
    });
    expect(confirmation.confirmed).toBe(true);
    expect(confirmation.basis).toBe('parcel_identifier_owner_corroborated');
    expect(confirmation.statement).toMatch(/agrees with the canonical owner/);
  });

  it('never lets owner agreement alone create a match', () => {
    const confirmation = confirmGisSubject({
      subject: SUBJECT, featureIdentifier: '999 99999', featureOwner: 'LANDSOUTH LLC',
    });
    expect(confirmation.confirmed).toBe(false);
  });
});

describe('the question controls the layers', () => {
  const LAYERS: GisLayerRef[] = [
    CURRENT_LAYER,
    { id: 'zoning', title: 'Character Districts' },
    { id: 'water', title: 'Water Mains' },
    { id: 'sewer', title: 'Sanitary Sewer' },
    { id: 'aerial', title: 'Aerial Imagery 2024' },
    { id: 'contours', title: 'Contours' },
  ];

  // Test 3.
  it('selects only layers relevant to the question, never all of them', () => {
    const zoning = selectLayersForQuestion('current_zoning', LAYERS);
    expect(zoning.map((l) => l.title)).toContain('Character Districts');
    expect(zoning.map((l) => l.title)).not.toContain('Aerial Imagery 2024');
    expect(zoning.map((l) => l.title)).not.toContain('Contours');

    expect(selectLayersForQuestion('public_water', LAYERS).map((l) => l.title)).toEqual(['Water Mains']);
    expect(selectLayersForQuestion('public_sewer', LAYERS).map((l) => l.title)).toEqual(['Sanitary Sewer']);
  });

  it('reports honestly when no layer answers the question', async () => {
    const result = await runInteractiveGisSession({
      subject: SUBJECT,
      question: 'public_sewer',
      appUrl: 'https://example.gov/map',
      sourceLabel: 'City of Fairview',
      executor: executor({ listLayers: vi.fn(async () => [{ id: 'aerial', title: 'Aerial Imagery' }]) }),
    });
    expect(result.outcome).toBe('no_relevant_layer');
    expect(result.notes.join(' ')).toMatch(/none matched the question/);
  });

  // Test 4.
  it('records which layers were visible in the evidence and the capture', async () => {
    const result = await runInteractiveGisSession({
      subject: SUBJECT,
      question: 'current_zoning',
      appUrl: 'https://example.gov/map',
      sourceLabel: 'City of Fairview',
      regimeAdoptedAt: REGIME_ADOPTED,
      executor: executor(),
    });
    expect(result.outcome).toBe('answered');
    expect(result.evidence?.screenshots[0].layersVisible).toEqual(['Parcels']);
    expect(result.notes.join(' ')).toMatch(/reported visible/);
    expect(result.notes.join(' ')).toMatch(/Layers not relevant to the question were left alone/);
  });
});

describe('current zoning requires a current layer', () => {
  // Test 5.
  it('accepts a layer edited at or after the governing adoption', () => {
    const assessment = assessZoningCurrency({
      layerLastEditedAt: CURRENT_LAYER.lastEditedAt, regimeAdoptedAt: REGIME_ADOPTED,
    });
    expect(assessment.verdict).toBe('current_regime');
    expect(assessment.establishesCurrent).toBe(true);
  });

  // Test 6 — the real trap. The city's previous zoning layer is official,
  // public, parcel-specific and says R20; it was last edited 2026-03-16,
  // seventeen days before the regime it would be quoted for took effect.
  it('refuses an official layer that predates the governing regime', () => {
    const assessment = assessZoningCurrency({
      layerLastEditedAt: SUPERSEDED_LAYER.lastEditedAt, regimeAdoptedAt: REGIME_ADOPTED,
    });
    expect(assessment.verdict).toBe('predates_regime');
    expect(assessment.establishesCurrent).toBe(false);
    expect(assessment.statement).toMatch(/depicts the PREVIOUS regime/);
  });

  it('does not claim currency when the vintage cannot be read', () => {
    expect(assessZoningCurrency({ layerLastEditedAt: null, regimeAdoptedAt: REGIME_ADOPTED }).establishesCurrent).toBe(false);
    expect(assessZoningCurrency({ layerLastEditedAt: '2026-08-13T00:00:00Z', regimeAdoptedAt: null }).establishesCurrent).toBe(false);
  });

  it('records the superseded reading as evidence of its own regime, not as current', async () => {
    const result = await runInteractiveGisSession({
      subject: SUBJECT,
      question: 'current_zoning',
      appUrl: 'https://example.gov/map',
      sourceLabel: 'City of Fairview',
      regimeAdoptedAt: REGIME_ADOPTED,
      executor: executor({
        listLayers: vi.fn(async () => [SUPERSEDED_LAYER]),
        readSubjectAttributes: vi.fn(async () => ({ Zoning: 'R20' })),
        readLegend: vi.fn(async () => [{ value: 'R20', label: 'R-20 - One and Two Family Residential' }]),
      }),
    });
    expect(result.evidence?.value).toBe('R20');
    expect(result.notes.join(' ')).toMatch(/before the governing zoning regime was adopted/);
    expect(result.notes.join(' ')).toMatch(/not as the CURRENT district/);
  });
});

describe('a mapped utility line is never service', () => {
  // Tests 7 and 8, in the GIS reading context.
  it('carries the capacity separation on a GIS-derived water reading', () => {
    const finding = buildUtilityInfrastructureFinding({
      kind: 'water', relationship: 'AT_SUBJECT',
      sourceLabel: 'Utility GIS — water layer', layerName: 'Water Mains',
      screenshotPath: 'store/browser-shots/water.png', retrievedAt: '2026-08-22T00:00:00.000Z',
    });
    expect(establishesServiceEntitlement('AT_SUBJECT')).toBe(false);
    expect(finding.doesNotEstablish).toContain('available capacity');
    expect(finding.doesNotEstablish).toContain('tap availability or tap approval');
  });

  it('carries the connection separation on a GIS-derived sewer reading', () => {
    const finding = buildUtilityInfrastructureFinding({
      kind: 'sewer', relationship: 'AT_SUBJECT',
      sourceLabel: 'Utility GIS — sewer layer', layerName: 'Sanitary Sewer',
      retrievedAt: '2026-08-22T00:00:00.000Z',
    });
    expect(finding.doesNotEstablish).toContain('connection approval');
    expect(finding.statement).toMatch(/does not establish capacity/);
  });

  // The live Fairview outcome: the WADC layers exist but their data lies ~17km
  // west, so the parcel is outside their coverage entirely.
  it('separates "the layer draws nothing here" from "no layer covers this parcel"', () => {
    const notShown = buildUtilityInfrastructureFinding({
      kind: 'water', relationship: 'NOT_SHOWN', sourceLabel: 'x', retrievedAt: 'now',
    });
    const unknown = buildUtilityInfrastructureFinding({
      kind: 'water', relationship: 'UNKNOWN', sourceLabel: 'x', retrievedAt: 'now',
    });
    expect(notShown.statement).toMatch(/Absence on a map is not proof/);
    expect(unknown.statement).toMatch(/no usable official utility layer was read/);
    expect(notShown.statement).not.toBe(unknown.statement);
  });
});

describe('evidence and screenshots must prove what they claim', () => {
  // Test 9.
  it('retains the application, layer, vintage and identity behind the reading', async () => {
    const result = await runInteractiveGisSession({
      subject: SUBJECT,
      question: 'current_zoning',
      appUrl: 'https://example.gov/map',
      sourceLabel: 'City of Fairview official ArcGIS Online zoning map',
      regimeAdoptedAt: REGIME_ADOPTED,
      executor: executor(),
    });
    const evidence = result.evidence!;
    expect(evidence.appUrl).toContain('fairviewtn.maps.arcgis.com');
    expect(evidence.layerName).toBe('Parcels');
    expect(evidence.layerUrl).toContain('NZM_Test_2/FeatureServer/31');
    expect(evidence.layerLastEditedAt).toBe('2026-08-13T13:26:42.897Z');
    expect(evidence.attribute).toBe('CD');
    expect(evidence.value).toBe('CD-3L');
    expect(evidence.legendLabel).toBe('CD-3L');
    expect(evidence.subject.observedIdentifier).toContain('12300');
    expect(evidence.retrievedAtIso).toBeTruthy();
  });

  it('refuses a screenshot that does not record the layer it is offered as proof of', () => {
    const shot = {
      path: 'store/browser-shots/x.png', purpose: 'zoning', layersVisible: [],
      legendCaptured: false, capturedAtIso: 'now',
    };
    expect(screenshotProves(shot, 'Parcels')).toBe(false);
    expect(screenshotProves({ ...shot, layersVisible: ['Parcels'] }, 'Parcels')).toBe(true);
    // A path alone is not evidence.
    expect(screenshotProves({ ...shot, path: '', layersVisible: ['Parcels'] }, 'Parcels')).toBe(false);
  });
});

describe('lane semantics for GIS answers', () => {
  // Tests 10 and 11.
  it('counts a returned zoning answer and keeps an unresolved utility lane out of it', () => {
    // Zoning returned; water and sewer unresolved after adaptive recovery.
    const tally = tallyResearchLanes([
      { status: 'completed' },                       // zoning_land_use — CD-3L
      { status: 'partial' },                         // access_utilities — no utility layer
      { status: 'failed' },                          // an unanswered lane
    ]);
    expect(tally.returned).toBe(1);
    expect(tally.partial).toBe(1);
    expect(tally.unresolved).toBe(1);
    expect(tally.headline).toBe('1 of 3 required lanes returned');
    expect(laneOutcome({ status: 'partial' })).toBe('PARTIAL');
    expect(laneOutcome({ status: 'completed', answered: false })).toBe('UNRESOLVED');
  });
});

describe('interactive GIS work is bounded', () => {
  // Test 12.
  it('spends a small finite number of interactions and stops', async () => {
    const result = await runInteractiveGisSession({
      subject: SUBJECT,
      question: 'current_zoning',
      appUrl: 'https://example.gov/map',
      sourceLabel: 'City of Fairview',
      regimeAdoptedAt: REGIME_ADOPTED,
      executor: executor(),
      maxInteractions: 3,
    });
    expect(result.interactionsUsed).toBeLessThanOrEqual(3);
    expect(result.outcome).toBe('budget_exhausted');
    expect(result.notes.join(' ')).toMatch(/deferred rather than retried/);
  });

  // Test 13.
  it('a failing application ends the session instead of retrying forever', async () => {
    const openApp = vi.fn(async () => { throw new Error('viewer never loaded'); });
    const result = await runInteractiveGisSession({
      subject: SUBJECT,
      question: 'current_zoning',
      appUrl: 'https://example.gov/map',
      sourceLabel: 'City of Fairview',
      executor: executor({ openApp }),
    });
    expect(result.outcome).toBe('app_unreachable');
    expect(openApp).toHaveBeenCalledTimes(1);
    expect(result.interactionsUsed).toBe(1);
  });

  it('an executor that throws mid-session degrades instead of escaping', async () => {
    const result = await runInteractiveGisSession({
      subject: SUBJECT,
      question: 'current_zoning',
      appUrl: 'https://example.gov/map',
      sourceLabel: 'City of Fairview',
      executor: executor({ readSubjectAttributes: vi.fn(async () => { throw new Error('service down'); }) }),
    });
    expect(result.outcome).toBe('no_value');
    expect(result.evidence).toBeNull();
  });
});

describe('the ArcGIS executor frames the map without pixel macros', () => {
  it('aims the application with its own documented URL parameters', () => {
    const url = framedAppUrl('https://x.maps.arcgis.com/apps/mapviewer/index.html?webmap=abc', { lon: -87.116026, lat: 35.976123 }, 16);
    expect(url).toContain('center=-87.116026,35.976123');
    expect(url).toContain('level=16');
    // The marker is what makes the capture self-evidencing: it shows WHICH
    // polygon the reading refers to.
    expect(url).toContain('marker=-87.116026,35.976123');
  });

  it('leaves the url alone when no confirmed point is available', () => {
    expect(framedAppUrl('https://x/map', null, 16)).toBe('https://x/map');
  });

  it('reads identity and owner from whichever field the county actually used', () => {
    expect(firstFieldValue({ MP: '042 12300' }, ['parcel_id', 'MP'])).toBe('042 12300');
    expect(firstFieldValue({ parcel_id: '  ', MP: '042 12300' }, ['parcel_id', 'MP'])).toBe('042 12300');
    expect(firstFieldValue({}, ['parcel_id'])).toBeNull();
  });
});

describe('reading the workspace runs no GIS research', () => {
  const read = (relative: string): string => fs.readFileSync(path.join(process.cwd(), relative), 'utf8');

  // Test 14.
  it('no page-load path invokes an interactive GIS session', () => {
    const page = read('web/src/pages/AcquisitionWorkspaceV2.tsx');
    expect(page).not.toMatch(/runInteractiveGisSession|interactive-gis|arcgis-interactive/i);
    // The workspace's load effects read; they do not start work.
    const runStatus = read('web/src/components/AcquisitionWorkspaceV2RunStatus.tsx');
    expect(runStatus).not.toMatch(/runInteractiveGisSession|arcgis/i);

    // The read routes must not call the session either.
    const routes = read('src/landos/routes.ts');
    const progressRoute = routes.slice(routes.indexOf("property-intelligence/progress'"), routes.indexOf("property-intelligence/progress'") + 1400);
    expect(progressRoute).not.toMatch(/runInteractiveGisSession/);
  });

  // Test 15.
  it('the readiness strip exposes one operator completeness projection, not a second lane count', () => {
    const strip = read('web/src/components/AcquisitionWorkspaceV2ResearchReadiness.tsx');
    expect(strip).toMatch(/operator\.headline/);
    expect(strip).toMatch(/returned/);
    expect(strip).toMatch(/partial/);
    expect(strip).toMatch(/unresolved/);
    expect(strip).toMatch(/blocked/);
    expect(strip).toMatch(/not required/i);
    expect(strip).toMatch(/excluded from the denominator/i);
    expect(strip).not.toMatch(/required lanes returned/);
  });
});
