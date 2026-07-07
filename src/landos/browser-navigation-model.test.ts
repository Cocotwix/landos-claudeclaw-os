import { beforeEach, describe, it, expect } from 'vitest';
import { _initTestLandosDb } from './db.js';
import {
  buildNavigationModel, mergeNavigationModel,
  getNavigationModel, saveNavigationModel, markNavigationModelReused, listNavigationModels,
  learnNavigation,
} from './browser-navigation-model.js';
import type { PageObservation } from './website-intelligence.js';

beforeEach(() => { _initTestLandosDb(); });

// ── Site fixtures spanning DIFFERENT interactive site types (genericness) ──────

// A LandPortal-like GIS/property site: method selector, State+County scope, tabs,
// overlays, pagination, a map. Includes parcel DATA in fields (must NOT be stored).
function lpObs(over: Partial<PageObservation> = {}): PageObservation {
  return {
    url: 'https://landportal.com/', title: 'Land Portal | GIS Mapping Software', headings: ['Map Search'],
    navItems: ['Map Search', 'Overview', 'Owner', 'Tax', 'Sales History', 'Comparables', 'Documents'],
    searchControls: [
      { selector: '#method', type: 'select-one', options: ['Address', 'APN', 'Owner'], label: 'Search by' },
      { selector: '#state', type: 'select-one', options: ['Tennessee', 'Georgia'], label: 'State' },
      { selector: '#county', type: 'select-one', options: ['Scott', 'White'], label: 'County' },
      { selector: '#term', placeholder: 'Enter APN' },
    ],
    buttons: ['Search', 'Basemaps & Overlays', 'Show on Map', 'Next', 'Export CSV'],
    links: [{ text: 'Help Center', href: '/help' }],
    hasMap: true, hasTable: false,
    fields: { Owner: 'JOHN Q SELLER', 'Parcel ID': '096-01500-000', Acreage: '42.1' }, // DATA — never stored
    loginLike: false, methodToggle: { current: 'Address' },
    ...over,
  };
}

// A County ArcGIS parcel viewer: map tools + layers + identify, no method dropdown.
function countyGisObs(): PageObservation {
  return {
    url: 'https://gis.scottcounty.gov/parcelviewer', title: 'Scott County GIS Parcel Viewer', headings: ['Parcel Search'],
    navItems: ['Parcel Search', 'Layers', 'Basemap'],
    searchControls: [{ selector: '#q', placeholder: 'Search parcel number or address', label: 'Parcel Search' }],
    buttons: ['Identify', 'Measure', 'Draw', 'Zoom In', 'Layers', 'Aerial Imagery', 'Print Map'],
    links: [], hasMap: true, hasTable: false, fields: {}, loginLike: false,
  };
}

// An assessor property-record site: table results, record card, no map.
function assessorObs(): PageObservation {
  return {
    url: 'https://assessor.example.gov/search', title: 'Board of Assessors — Property Record Search', headings: ['Real Property Search'],
    navItems: ['Search', 'Owner', 'Sales', 'Tax'],
    searchControls: [{ selector: '#pin', placeholder: 'Enter Parcel ID / PIN', label: 'Parcel ID' }],
    buttons: ['Search', 'Next'],
    links: [], hasMap: false, hasTable: true, fields: {}, loginLike: false,
  };
}

// A Register of Deeds / recorder site: document search + document access.
function recorderObs(): PageObservation {
  return {
    url: 'https://deeds.example.gov/', title: 'Register of Deeds — Land Records Search', headings: ['Recorded Documents Search'],
    navItems: ['Document Search', 'Recorded Documents'],
    searchControls: [
      { selector: '#type', type: 'select-one', options: ['Grantor', 'Grantee', 'Instrument'], label: 'Search Type' },
      { selector: '#name', placeholder: 'Enter name', label: 'Owner' },
    ],
    buttons: ['Search', 'View Image', 'Download PDF', 'Next'],
    links: [], hasMap: false, hasTable: true, fields: {}, loginLike: false,
  };
}

// ── BUILD — answers the navigation questions, from any site type ───────────────
describe('buildNavigationModel — learns the navigation model of a site', () => {
  it('LandPortal: search modes, required selector order, field order, dependencies, signals', () => {
    const m = buildNavigationModel('landportal.com', lpObs());
    expect(m.searchModes).toEqual(expect.arrayContaining(['apn', 'address', 'owner']));
    expect(m.supportedIdentifiers).toEqual(expect.arrayContaining(['apn', 'address', 'owner']));
    expect(m.requiredSelectors).toEqual(['State', 'County']);            // scope order
    expect(m.fieldOrder[0]).toBe('search mode');                          // method dropdown first
    expect(m.fieldOrder).toEqual(['search mode', 'State', 'County', 'search identifier', 'submit']);
    expect(m.mandatoryFields).toContain('search identifier');
    expect(m.tabs.length).toBeGreaterThan(0);
    expect(m.layers).toEqual(expect.arrayContaining(['Basemaps & Overlays']));
    expect(m.detailAccess.how).toMatch(/map result/i);
    expect(m.navigationDependencies).toEqual(expect.arrayContaining([expect.stringMatching(/Set State before County/i)]));
    expect(m.successSignals.some((s) => /record\/detail page/i.test(s))).toBe(true);
    expect(m.failureSignals.some((s) => /login page/i.test(s))).toBe(true);
    expect(m.version).toBe(1);
  });

  it('NEVER stores page DATA — no field values leak into the navigation model', () => {
    const m = buildNavigationModel('landportal.com', lpObs());
    const blob = JSON.stringify(m);
    expect(blob).not.toContain('JOHN Q SELLER');
    expect(blob).not.toContain('096-01500-000');
    expect(blob).not.toContain('42.1');
  });

  it('County GIS: captures map tools + layers (generic, no LandPortal specifics)', () => {
    const m = buildNavigationModel('gis.scottcounty.gov', countyGisObs());
    expect(m.classification).toBe('gis_map');
    expect(m.mapTools).toEqual(expect.arrayContaining(['Identify', 'Measure', 'Draw']));
    expect(m.layers.length).toBeGreaterThan(0);
    expect(m.requiredSelectors).toEqual([]); // single search box, no scope gate
  });

  it('Assessor: results open as a table row; reaches a record page', () => {
    const m = buildNavigationModel('assessor.example.gov', assessorObs());
    expect(m.resultAccess.how).toMatch(/row/i);
    expect(m.detailAccess.how).toMatch(/result row/i);
  });

  it('Recorder: learns how documents are opened', () => {
    const m = buildNavigationModel('deeds.example.gov', recorderObs());
    expect(m.documentAccess.via).toEqual(expect.arrayContaining(['View Image', 'Download PDF']));
    expect(m.navigationDependencies.some((d) => /before documents or exports/i.test(d))).toBe(true);
  });
});

// ── MERGE — expand naturally; relearn only affected portions; bump version ─────
describe('mergeNavigationModel — expand + selective relearn', () => {
  it('new knowledge EXPANDS the model and bumps only the affected sections + version', () => {
    const base = buildNavigationModel('site.gov', assessorObs()); // no map tools/layers
    const withMap = buildNavigationModel('site.gov', { ...assessorObs(), buttons: ['Search', 'Measure', 'Identify', 'Aerial Imagery'], hasMap: true });
    const { model, changedSections, versionBumped } = mergeNavigationModel(base, withMap);
    expect(versionBumped).toBe(true);
    expect(model.version).toBe(base.version + 1);
    expect(changedSections).toEqual(expect.arrayContaining(['mapTools', 'layers']));
    expect(model.mapTools).toEqual(expect.arrayContaining(['Measure', 'Identify']));
    // sections that did not change keep their revision
    expect(model.sectionRevisions.mapTools).toBe(2);
    expect(model.sectionRevisions.resultAccess).toBe(1);
  });

  it('an identical re-observation changes NOTHING (no version churn)', () => {
    const base = buildNavigationModel('same.gov', lpObs());
    const again = buildNavigationModel('same.gov', lpObs());
    const { changedSections, versionBumped, model } = mergeNavigationModel(base, again);
    expect(versionBumped).toBe(false);
    expect(changedSections).toEqual([]);
    expect(model.version).toBe(base.version);
  });

  it('an empty fresh section never ERASES learned knowledge', () => {
    const rich = buildNavigationModel('keep.gov', lpObs());
    const bare = buildNavigationModel('keep.gov', { ...lpObs(), navItems: [], buttons: ['Search'] });
    const { model } = mergeNavigationModel(rich, bare);
    expect(model.tabs.length).toBeGreaterThan(0);       // tabs survived
    expect(model.layers.length).toBeGreaterThan(0);     // layers survived
  });

  it('a CHANGED capability description relearns just that section', () => {
    const base = buildNavigationModel('moved.gov', assessorObs());     // result-as-row
    const changedSite = buildNavigationModel('moved.gov', { ...assessorObs(), hasTable: false, hasMap: true }); // result-on-map
    const { model, changedSections } = mergeNavigationModel(base, changedSite);
    expect(changedSections).toContain('resultAccess');
    expect(model.resultAccess.how).toMatch(/map|panel/i);
    expect(model.sectionRevisions.resultAccess).toBe(2);
  });
});

// ── STORAGE (platform-keyed, versioned) ───────────────────────────────────────
describe('navigation model storage', () => {
  it('starts empty, saves, reads back, lists, and counts reuse', () => {
    expect(getNavigationModel('gis.county.gov')).toBeNull();
    const saved = saveNavigationModel(buildNavigationModel('gis.county.gov', countyGisObs()));
    expect(saved.version).toBe(1);
    expect(getNavigationModel('gis.county.gov')!.mapTools.length).toBeGreaterThan(0);
    markNavigationModelReused('gis.county.gov');
    expect(getNavigationModel('gis.county.gov')!.timesReused).toBe(1);
    expect(listNavigationModels().length).toBe(1);
  });
});

// ── LEARN — the orchestration Browser Intelligence runs on every inspection ────
describe('learnNavigation — first learn, reuse, and automatic relearn', () => {
  it('first visit LEARNS at v1', () => {
    const r = learnNavigation('first.gov', lpObs());
    expect(r.created).toBe(true);
    expect(r.versionBumped).toBe(true);
    expect(getNavigationModel('first.gov')!.version).toBe(1);
  });

  it('an unchanged repeat visit REUSES (no version churn), reuse counted', () => {
    learnNavigation('repeat.gov', lpObs());
    const r = learnNavigation('repeat.gov', lpObs());
    expect(r.created).toBe(false);
    expect(r.versionBumped).toBe(false);
    expect(getNavigationModel('repeat.gov')!.timesReused).toBe(1);
    expect(getNavigationModel('repeat.gov')!.version).toBe(1);
  });

  it('a changed site RELEARNS only the affected portion and bumps the version', () => {
    learnNavigation('evolve.gov', assessorObs());
    const r = learnNavigation('evolve.gov', { ...assessorObs(), buttons: ['Search', 'Measure', 'Identify'], hasMap: true });
    expect(r.versionBumped).toBe(true);
    expect(r.changedSections).toContain('mapTools');
    expect(getNavigationModel('evolve.gov')!.version).toBe(2);
  });

  it('ONE shared model per site accumulates knowledge across DIFFERENT tasks/departments', () => {
    // Department A visits the parcel-search surface; Department B later opens a
    // document surface on the SAME platform — one navigation model grows.
    learnNavigation('shared.gov', assessorObs());
    learnNavigation('shared.gov', recorderObs()); // same platform key, different task surface
    const model = getNavigationModel('shared.gov')!;
    expect(model.documentAccess.via).toEqual(expect.arrayContaining(['View Image', 'Download PDF']));
    expect(listNavigationModels().filter((m) => m.platform === 'shared.gov').length).toBe(1);
  });
});
