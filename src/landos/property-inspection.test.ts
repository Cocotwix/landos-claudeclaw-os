import { describe, expect, it } from 'vitest';
import { runPropertyInspection } from './property-inspection.js';
import type { BrowserEvidence, BrowserService } from './browser-intelligence.js';

function fakeService(ev: BrowserEvidence): BrowserService {
  return {
    id: ev.service,
    label: ev.service,
    modes: ['workflow', 'ask'],
    configured() { return true; },
    async runWorkflow() { return ev; },
    async ask() { return ev; },
  };
}

describe('Property Inspection capability', () => {
  it('reuses a LandPortal inspection package and derives concise questions', async () => {
    const landportal = {
      service: 'landportal',
      mode: 'workflow',
      status: 'retrieved',
      patch: {},
      fields: {},
      facts: [],
      sourcesUsed: [{ type: 'landportal', url: 'https://landportal.com/p', origin: 'landportal', confidence: 0.9 }],
      screenshots: [],
      blocked: [],
      sourceUrls: ['https://landportal.com/p'],
      note: 'LandPortal inspection captured.',
      inspection: {
        parcelUrl: 'https://landportal.com/p',
        comparablesUrl: 'https://landportal.com/c',
        parcelFacts: { 'Owner Name': 'DOE', 'Parcel ID': '123', Acres: '10', 'Water Feature type(s)': 'Pond', 'Land Locked': 'No' },
        assets: [],
        overlays: [{ overlay: 'Wetlands', status: 'captured', note: 'Wetlands overlay screenshot.', confidence: 'low', screenshotKey: 'overlay_wetlands' }],
        visualObservations: [{ label: 'Water feature visible', detail: 'Pond visible.', confidence: 'medium', evidence: 'Imagery' }],
        comparables: [
          { rawText: '123 County Rd Sold $100,000 10 ac $50,000/ac', sourceUrl: 'https://landportal.com/c', acres: 10, price: 100000, pricePerAcre: 50000, status: 'sold', improvement: 'vacant', confidence: 'medium' },
          { rawText: '123 County Rd Sold $100,000 10 ac $50,000/ac', sourceUrl: 'https://landportal.com/c', acres: 10, price: 100000, pricePerAcre: 50000, status: 'sold', improvement: 'vacant', confidence: 'medium' },
        ],
      },
    } satisfies BrowserEvidence;
    const result = await runPropertyInspection({
      searchKey: { address: '2510 State Highway 153', county: 'Runnels', state: 'TX' },
      existingEvidence: [landportal],
      timeoutMs: 1000,
    }, {
      landPortalBrowser: fakeService(landportal),
      googleVisualConfigured: false,
    });
    expect(result.inspection.parcelUrl).toBe('https://landportal.com/p');
    expect((result.inspection.sources ?? []).some((s) => s.provider === 'LandPortal')).toBe(true);
    expect(result.inspection.comparables).toHaveLength(1);
    expect(result.inspection.comparables[0].pricePerAcre).toBe(10000);
    expect(result.inspection.discoveryQuestions).toContain('Wetland delineation completed?');
    expect(result.inspection.discoveryQuestions).toContain('Existing survey?');
  });

  it('falls back to county records when no LandPortal inspection exists', async () => {
    const county = {
      service: 'county_records',
      mode: 'workflow',
      status: 'retrieved',
      patch: {},
      fields: {},
      facts: [
        { key: 'owner', label: 'Official owner', value: 'DOE', sourceName: 'County Assessor', sourceType: 'assessor', sourceUrl: 'https://county.example/assessor', confidence: 'high', origin: 'netr_county', status: 'extracted' },
        { key: 'apn', label: 'APN / parcel ID', value: 'R123', sourceName: 'County Assessor', sourceType: 'assessor', sourceUrl: 'https://county.example/assessor', confidence: 'high', origin: 'netr_county', status: 'extracted' },
      ],
      sourcesUsed: [{ type: 'assessor', url: 'https://county.example/assessor', origin: 'netr_county', confidence: 0.9 }],
      screenshots: [],
      blocked: [],
      sourceUrls: ['https://county.example/assessor'],
      note: 'County assessor reached via NETR.',
    } satisfies BrowserEvidence;
    const result = await runPropertyInspection({
      searchKey: { owner: 'DOE', county: 'Runnels', state: 'TX' },
      timeoutMs: 1000,
    }, {
      countyRecordsBrowser: fakeService(county),
      googleVisualConfigured: false,
    });
    expect(result.inspection.parcelFacts['Official owner']).toBe('DOE');
    expect(result.routes.find((r) => r.provider === 'Official Assessor')?.status).toBe('used');
    expect(result.routes.find((r) => r.provider === 'NETR')?.status).toBe('used');
  });
});
