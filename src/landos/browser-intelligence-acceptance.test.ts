// Phase 8 acceptance — Browser Intelligence on the four required properties.
// Deterministic (injected drivers/providers; no network, no paid actions).

import { describe, it, expect } from 'vitest';
import { resolveProperty, type ResolutionDeps } from './property-resolution-engine.js';
import { makeLandPortalBrowser } from './landportal-browser.js';
import { makeCountyRecordsBrowser } from './county-records-browser.js';
import type { DukeVerificationResult } from './duke-verification-bridge.js';
import type { BrowserDriver, BrowserPageRead } from './browser-intelligence.js';

const NOW = () => '2026-06-29T00:00:00.000Z';

const ADDRESSES = [
  { text: '388 Gilstrap Rd, Cleveland, GA 30528', apn: '042 123', county: 'White' },
  { text: '166 Thamon Rd, Cleveland, GA', apn: '011 045', county: 'White' },
  { text: '514 Wilderness Trl, Cleveland, GA', apn: '073 220', county: 'White' },
  { text: '2123 Panola Rd, Lithonia, GA', apn: '16 038 07 001', county: 'DeKalb' },
];

// One fake LandPortal driver per property — returns a full property page read so
// the live workflow path (one screenshot + extraction) is exercised.
function lpDriverFor(a: { apn: string; county: string; text: string }): BrowserDriver {
  const addr = a.text.split(',')[0];
  const read: BrowserPageRead = {
    url: 'https://www.landportal.com/property/x',
    fields: {
      'Property Address': addr, APN: a.apn, Owner: 'RECORD OWNER', County: a.county, State: 'GA',
      Acreage: '6.1 ac', 'Land Use': 'Vacant', FEMA: 'Zone X', Wetlands: 'None mapped', 'Road Frontage': '180 ft',
    },
    snippets: [],
  };
  return {
    id: 'lp', configured: () => true,
    async open() { return { url: 'https://www.landportal.com', fields: {}, snippets: [] }; },
    async search() { return read; },
    async readFields() { return read; },
    async screenshot(purpose) { return { path: '/tmp/lp.png', capturedAtIso: NOW(), purpose }; },
  };
}

function needsCounty(): DukeVerificationResult {
  return { status: 'unverified', parcelVerified: false, sourceAttempts: [], dataGaps: ['needs_county_or_fips'], marketPulseEligible: false, strategyUnderwritingBlocked: true, summary: 'needs county', executionMode: 'duke_verification_read_only' };
}

describe('Phase 8 acceptance — Browser Intelligence on the four properties', () => {
  for (const a of ADDRESSES) {
    it(`${a.text}: LandPortal first, one screenshot, county fills only gaps, no duplicate, no paid actions`, async () => {
      const deps: ResolutionDeps = {
        verify: async () => needsCounty(),
        deriveCounty: async () => ({ county: a.county, state: 'GA', zip: null, fips: '13311', lat: 34.5, lng: -83.7 }),
        suggest: async (q) => ({ query: q, source: 'Photon', cached: false, suggestions: [{ label: `${a.text}`, line1: a.text.split(',')[0], city: 'Cleveland', state: 'GA', county: a.county, coordinates: { lat: 34.5, lng: -83.7 }, source: 'Photon', confidence: 0.8 }] }),
        landPortalBrowser: makeLandPortalBrowser({ driver: lpDriverFor(a) }),
        countyRecordsBrowser: makeCountyRecordsBrowser(), // parked → gap-fill PLAN only
        now: NOW,
      };
      const r = await resolveProperty({ rawText: a.text }, deps);

      // LandPortal browser runs FIRST among browser services.
      expect(r.browserEvidence[0].service).toBe('landportal');
      // Exactly ONE property screenshot.
      expect(r.browserEvidence[0].screenshots).toHaveLength(1);
      // Structured property facts extracted (the real output, not the screenshot).
      expect(r.browserEvidence[0].patch.apn).toBe(a.apn);
      expect(r.browserEvidence[0].patch.county).toBe(a.county);
      expect(Object.keys(r.browserEvidence[0].fields)).toContain('FEMA');
      // County fills only gaps — APN/owner/county from LandPortal are NOT re-collected.
      expect(r.missingFieldAnalysis!.missing).not.toContain('apn');
      expect(r.missingFieldAnalysis!.missing).not.toContain('owner');
      expect(r.missingFieldAnalysis!.missing).not.toContain('county');
      // County is queried for authoritative records (deed/plat/tax/ownership/GIS).
      expect(r.missingFieldAnalysis!.countyVerifies).toEqual(expect.arrayContaining(['recorded_deed', 'tax_status', 'gis_parcel']));
      expect(r.browserEvidence[1].service).toBe('county_records');
      // No paid/billing action occurred anywhere.
      for (const ev of r.browserEvidence) expect(ev.blocked).toHaveLength(0);
      // Property resolved (Deal Card would receive this + the browser evidence).
      expect(r.status).toBe('matched');
    });
  }

  it('Ask Mode works (natural questions route to the right service/workflow)', async () => {
    const lp = makeLandPortalBrowser({ driver: lpDriverFor(ADDRESSES[0]) });
    const evFema = await lp.ask('Show me FEMA', { county: 'White', state: 'GA', address: '388 Gilstrap Rd' }, { timeoutMs: 1000 });
    expect(evFema.fields).toHaveProperty('FEMA');

    const county = makeCountyRecordsBrowser();
    const evDeed = await county.ask('Find the last recorded deed', { county: 'White', state: 'GA' }, { timeoutMs: 1000 });
    expect(evDeed.mode).toBe('ask');
    expect(evDeed.note).toMatch(/recorded_deed|recorder|parked/i);
  });

  it('Workflow Mode works (county retrieves only the still-missing fields)', async () => {
    const county = makeCountyRecordsBrowser();
    const ev = await county.runWorkflow({ searchKey: { county: 'White', state: 'GA' }, neededFields: ['recorded_deed', 'gis_parcel'] }, { timeoutMs: 1000 });
    expect(ev.mode).toBe('workflow');
    expect(ev.note).toMatch(/recorder|gis/);
  });
});
