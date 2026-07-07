import { beforeEach, describe, it, expect } from 'vitest';
import { _initTestLandosDb } from './db.js';
import {
  inspectSite, synthesizePlaybook,
  getSitePlaybook, saveSitePlaybook, markPlaybookReused, listSitePlaybooks,
  retrieveWithLearning, type SiteStructure,
} from './browser-learning.js';
import type { PageObservation } from './website-intelligence.js';

beforeEach(() => { _initTestLandosDb(); });

// A LandPortal-like page: a method selector (Address/APN/Owner), State + County
// scope selects, tabs, expandable overlays, pagination, and a map.
function lpObs(over: Partial<PageObservation> = {}): PageObservation {
  return {
    url: 'https://landportal.com/', title: 'Land Portal | GIS Mapping Software', headings: ['Map Search'],
    navItems: ['Map Search', 'Overview', 'Owner', 'Tax', 'Sales History', 'Comparables'],
    searchControls: [
      { selector: '#method', type: 'select-one', options: ['Address', 'APN', 'Owner'], label: 'Search by' },
      { selector: '#state', type: 'select-one', options: ['Tennessee', 'Georgia'], label: 'State' },
      { selector: '#county', type: 'select-one', options: ['Scott', 'White'], label: 'County' },
      { selector: '#term', placeholder: 'Enter APN' },
    ],
    buttons: ['Search', 'Basemaps & Overlays', 'Show on Map', 'Next'],
    links: [], hasMap: true, hasTable: false, fields: {}, loginLike: false, methodToggle: { current: 'Address' },
    ...over,
  };
}

// ── INSPECT ────────────────────────────────────────────────────────────────
describe('inspectSite — learns how a site actually works', () => {
  it('extracts search modes, the method dropdown, required scope, tabs, expandables, pagination, parcel-detail nav', () => {
    const s = inspectSite(lpObs());
    expect(s.searchModes).toEqual(expect.arrayContaining(['apn', 'address', 'owner']));
    expect(s.hasMethodDropdown).toBe(true);
    expect(s.requiredFields).toEqual(['State', 'County']); // State first, County second
    expect(s.dropdowns).toEqual(expect.arrayContaining(['Search by', 'State', 'County']));
    expect(s.expandableSections).toEqual(expect.arrayContaining(['Basemaps & Overlays', 'Show on Map']));
    expect(s.hasPagination).toBe(true);
    expect(s.tabs.length).toBeGreaterThan(0);
    expect(s.parcelDetailNav).toMatch(/map result/i);
    expect(s.multiStep).toBe(true);
  });

  it('a plain single-box site is single-step with no method dropdown', () => {
    const s = inspectSite({
      url: 'https://x/', title: 'Search', headings: [], navItems: [], buttons: ['Go'],
      searchControls: [{ selector: '#q', placeholder: 'Search address' }],
      links: [], hasMap: false, hasTable: true, fields: {}, loginLike: false,
    });
    expect(s.hasMethodDropdown).toBe(false);
    expect(s.requiredFields).toEqual([]);
    expect(s.multiStep).toBe(false);
    expect(s.hasResultTable).toBe(true);
    expect(s.parcelDetailNav).toMatch(/result row/i);
  });
});

// ── SYNTHESIZE ───────────────────────────────────────────────────────────────
describe('synthesizePlaybook — value-free navigation workflow', () => {
  it('APN lookup: select method → scope State→County → fill → submit → open result', () => {
    const pb = synthesizePlaybook('landportal.com', 'parcel_lookup', inspectSite(lpObs()), 'apn');
    const actions = pb.workflow.map((s) => s.action);
    expect(actions[0]).toBe('select_method');
    expect(pb.workflow[0].text).toBe('apn');
    // scope steps preserve State-then-County order
    const scopeTexts = pb.workflow.filter((s) => s.action === 'open_panel').map((s) => s.text);
    expect(scopeTexts).toEqual(['State', 'County']);
    expect(actions).toContain('fill');
    expect(actions).toContain('submit');
    expect(actions[actions.length - 1]).toBe('click');
    // No hardcoded parcel value — the fill is a placeholder.
    expect(pb.workflow.find((s) => s.action === 'fill')!.value).toBe('<apn>');
    expect(pb.version).toBe(1);
  });
});

// ── STORAGE (versioned) ──────────────────────────────────────────────────────
describe('site playbook storage — versionable + updateable', () => {
  const pb = () => synthesizePlaybook('gis.county.gov', 'parcel_lookup', inspectSite(lpObs()), 'apn');

  it('starts empty, saves at v1, relearn bumps to v2, reuse counts', () => {
    expect(getSitePlaybook('gis.county.gov')).toBeNull();
    const v1 = saveSitePlaybook(pb());
    expect(v1.version).toBe(1);
    expect(getSitePlaybook('gis.county.gov')!.version).toBe(1);
    const v2 = saveSitePlaybook(pb()); // relearn after the site changed
    expect(v2.version).toBe(2);
    markPlaybookReused('gis.county.gov');
    expect(getSitePlaybook('gis.county.gov')!.timesReused).toBe(1);
    expect(listSitePlaybooks().length).toBe(1);
  });
});

// ── ORCHESTRATION (all acceptance criteria) ──────────────────────────────────
describe('retrieveWithLearning — inspect only when needed', () => {
  const badStructure = (): SiteStructure => inspectSite(lpObs());

  it('A) retrieval SUCCEEDS on first attempt → NO inspection, no playbook saved', async () => {
    let attempts = 0;
    const r = await retrieveWithLearning<string>({
      platform: 'ok.com', taskType: 'parcel_lookup', identifierKind: 'apn',
      inspect: () => { throw new Error('inspect must not run on success'); },
      attempt: async () => { attempts++; return { retrieved: true, evidence: 'OK', observation: null }; },
    });
    expect(r.retrieved).toBe(true);
    expect(r.inspected).toBe(false);
    expect(attempts).toBe(1);
    expect(getSitePlaybook('ok.com')).toBeNull();
  });

  it('B) retrieval FAILS → inspects, synthesizes, RETRIES with the learned workflow, SAVES it', async () => {
    let n = 0;
    const r = await retrieveWithLearning<string>({
      platform: 'gis.county.gov', taskType: 'parcel_lookup', identifierKind: 'apn',
      attempt: async () => { n += 1; return n === 1 ? { retrieved: false, evidence: 'fail', observation: lpObs() } : { retrieved: true, evidence: 'OK2', observation: null }; },
    });
    expect(n).toBe(2);              // first failed, retried once
    expect(r.inspected).toBe(true);
    expect(r.retrieved).toBe(true);
    expect(r.relearned).toBe(false); // no prior playbook
    const saved = getSitePlaybook('gis.county.gov');
    expect(saved).not.toBeNull();
    expect(saved!.version).toBe(1);
    expect(saved!.workflow[0].action).toBe('select_method'); // the learned workflow was stored
    expect(saved!.structure.requiredFields).toEqual(['State', 'County']);
  });

  it('C) a stored playbook is REUSED (no inspection), and reuse is counted', async () => {
    saveSitePlaybook(synthesizePlaybook('reuse.com', 'parcel_lookup', badStructure(), 'apn'));
    let inspected = false;
    const r = await retrieveWithLearning<string>({
      platform: 'reuse.com', taskType: 'parcel_lookup', identifierKind: 'apn',
      inspect: () => { inspected = true; return badStructure(); },
      attempt: async ({ playbook }) => { expect(playbook).not.toBeNull(); return { retrieved: true, evidence: 'OK', observation: null }; },
    });
    expect(r.reusedPlaybook).toBe(true);
    expect(r.inspected).toBe(false);
    expect(inspected).toBe(false);
    expect(getSitePlaybook('reuse.com')!.timesReused).toBe(1);
  });

  it('D) a STALE stored playbook fails → relearns and bumps the version', async () => {
    saveSitePlaybook(synthesizePlaybook('stale.com', 'parcel_lookup', badStructure(), 'apn')); // v1
    let n = 0;
    const r = await retrieveWithLearning<string>({
      platform: 'stale.com', taskType: 'parcel_lookup', identifierKind: 'apn',
      attempt: async () => { n += 1; return n === 1 ? { retrieved: false, evidence: 'fail', observation: lpObs() } : { retrieved: true, evidence: 'OK', observation: null }; },
    });
    expect(r.relearned).toBe(true);
    expect(r.retrieved).toBe(true);
    expect(getSitePlaybook('stale.com')!.version).toBe(2); // bumped after relearn
  });

  it('E) retry with the learned workflow STILL fails → no playbook saved, no false facts', async () => {
    const r = await retrieveWithLearning<string>({
      platform: 'hard.com', taskType: 'parcel_lookup', identifierKind: 'apn',
      attempt: async () => ({ retrieved: false, evidence: 'no-match', observation: lpObs() }),
    });
    expect(r.retrieved).toBe(false);
    expect(r.inspected).toBe(true);
    expect(getSitePlaybook('hard.com')).toBeNull();
  });

  it('F) nothing observable to inspect → no inspection, honest failure', async () => {
    const r = await retrieveWithLearning<string>({
      platform: 'blind.com', taskType: 'parcel_lookup', identifierKind: 'apn',
      attempt: async () => ({ retrieved: false, evidence: 'x', observation: null }),
    });
    expect(r.inspected).toBe(false);
    expect(r.retrieved).toBe(false);
    expect(getSitePlaybook('blind.com')).toBeNull();
  });
});
