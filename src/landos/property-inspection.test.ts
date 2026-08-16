import { describe, expect, it } from 'vitest';
import { runPropertyInspection } from './property-inspection.js';
import type { BrowserEvidence, BrowserSearchKey, BrowserService } from './browser-intelligence.js';

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
      sourceAttempts: [{
        sourceName: 'Example County Assessor',
        sourceType: 'assessor',
        sourceUrl: 'https://county.example/assessor',
        attemptedAt: '2026-07-28T12:00:00.000Z',
        result: 'retrieved',
        factCount: 2,
        note: 'Two subject-property facts retrieved.',
      }],
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
    expect(result.inspection.sources).toContainEqual(expect.objectContaining({
      provider: 'Example County Assessor',
      resultKind: 'retrieved',
      attemptedAt: '2026-07-28T12:00:00.000Z',
    }));
    expect(result.inspection.sources?.some((source) => source.provider === 'County Records Browser')).toBe(false);
    expect(result.inspection.evidence).toContainEqual(expect.objectContaining({
      label: 'Official owner',
      source: 'County Assessor',
      url: 'https://county.example/assessor',
    }));
    expect(result.routes.find((r) => r.provider === 'Official Assessor')?.status).toBe('used');
    expect(result.routes.find((r) => r.provider === 'NETR')?.status).toBe('used');
  });

  it('continues to county records for deep-record work after LandPortal has core parcel facts', async () => {
    const landportal = {
      service: 'landportal', mode: 'workflow', status: 'retrieved', patch: {}, fields: {}, facts: [], sourcesUsed: [], screenshots: [], blocked: [], sourceUrls: [], note: 'parcel read',
      inspection: { parcelUrl: 'https://landportal.example/parcel', comparablesUrl: null, parcelFacts: { 'Owner Name': 'DOE', 'Parcel ID': 'R123', Acres: '10' }, assets: [], overlays: [], visualObservations: [], comparables: [] },
    } satisfies BrowserEvidence;
    const county = {
      service: 'county_records', mode: 'workflow', status: 'retrieved', patch: {}, fields: {}, screenshots: [], blocked: [], sourceUrls: ['https://county.example/recorder'], note: 'recorder reached',
      facts: [{ key: 'deedLink', label: 'Recorder / Register of Deeds link', value: 'https://county.example/recorder', sourceName: 'County Recorder', sourceType: 'recorder', sourceUrl: 'https://county.example/recorder', confidence: 'high', origin: 'netr_county', status: 'extracted' }],
      sourcesUsed: [{ type: 'recorder', url: 'https://county.example/recorder', origin: 'netr_county', confidence: 0.9 }],
    } satisfies BrowserEvidence;
    const result = await runPropertyInspection({ searchKey: { address: '1 Main St', county: 'Example', state: 'TX' }, mode: 'deep_record', timeoutMs: 1000 }, {
      landPortalBrowser: fakeService(landportal), countyRecordsBrowser: fakeService(county), googleVisualConfigured: false,
    });
    expect(result.routes.find((route) => route.provider === 'Official Recorder')?.status).toBe('used');
    expect((result.inspection.sources ?? []).some((source) => source.provider === 'County Records Browser')).toBe(true);
  });

  it('routes county work from verified LandPortal locality when the intake omitted jurisdiction', async () => {
    const landportal = {
      service: 'landportal', mode: 'workflow', status: 'retrieved', patch: {}, fields: {}, facts: [], sourcesUsed: [], screenshots: [], blocked: [], sourceUrls: [], note: 'parcel read',
      inspection: { parcelUrl: 'https://landportal.example/parcel', comparablesUrl: null, parcelFacts: { 'Owner Name': 'DOE', 'Parcel ID': 'R123', Acres: '10', County: 'Runnels', State: 'TX' }, assets: [], overlays: [], visualObservations: [], comparables: [] },
    } satisfies BrowserEvidence;
    let receivedKey: BrowserSearchKey | undefined;
    const county: BrowserService = {
      ...fakeService({ service: 'county_records', mode: 'workflow', status: 'partial', patch: {}, fields: {}, facts: [], sourcesUsed: [], screenshots: [], blocked: [], sourceUrls: [], note: 'county route attempted' }),
      async runWorkflow(input) { receivedKey = input.searchKey; return { service: 'county_records', mode: 'workflow', status: 'partial', patch: {}, fields: {}, facts: [], sourcesUsed: [], screenshots: [], blocked: [], sourceUrls: [], note: 'county route attempted' }; },
    };
    await runPropertyInspection({ searchKey: { address: '2510 State Highway 153' }, mode: 'deep_record', timeoutMs: 1000 }, {
      landPortalBrowser: fakeService(landportal), countyRecordsBrowser: county, googleVisualConfigured: false,
    });
    expect(receivedKey).toMatchObject({ county: 'Runnels', state: 'TX', address: '2510 State Highway 153' });
  });

  it('shares one deadline across sequential LandPortal and county providers', async () => {
    const landportal = {
      service: 'landportal', mode: 'workflow', status: 'retrieved', patch: {}, fields: {}, facts: [], sourcesUsed: [], screenshots: [], blocked: [], sourceUrls: [], note: 'parcel read',
      inspection: { parcelUrl: 'https://landportal.example/parcel', comparablesUrl: null, parcelFacts: { 'Owner Name': 'DOE', 'Parcel ID': 'R123', Acres: '10' }, assets: [], overlays: [], visualObservations: [], comparables: [] },
    } satisfies BrowserEvidence;
    const county = {
      service: 'county_records', mode: 'workflow', status: 'partial', patch: {}, fields: {}, facts: [], sourcesUsed: [], screenshots: [], blocked: [], sourceUrls: [], note: 'county attempted',
    } satisfies BrowserEvidence;
    const budgets: number[] = [];
    let clock = 1_000;
    const landPortalService: BrowserService = {
      ...fakeService(landportal),
      async runWorkflow(_input, options) {
        budgets.push(options.timeoutMs);
        clock += 400;
        return landportal;
      },
    };
    const countyService: BrowserService = {
      ...fakeService(county),
      async runWorkflow(_input, options) {
        budgets.push(options.timeoutMs);
        return county;
      },
    };

    await runPropertyInspection({
      searchKey: { address: '1 Main St', county: 'Example', state: 'TX' },
      mode: 'deep_record',
      timeoutMs: 1_000,
    }, {
      landPortalBrowser: landPortalService,
      countyRecordsBrowser: countyService,
      googleVisualConfigured: false,
      nowMs: () => clock,
    });

    // ONE deadline, and the official-records lane holds a reserved share of it.
    // LandPortal used to be handed the whole budget and routinely consumed it,
    // so the county lane — the only path to the assessor, recorder and
    // collecting office — was recorded as "queued for the next run" every run.
    // The reserve is capped at a third of the budget so a tight deadline cannot
    // starve the parcel read instead: 1000ms → 333 reserved, 667 to LandPortal,
    // and the county lane still gets whatever is genuinely left (600 here).
    expect(budgets).toEqual([667, 600]);
  });

  it('does not reserve official-records time when that lane will not run', async () => {
    const landportal = {
      service: 'landportal', mode: 'workflow', status: 'retrieved', patch: {}, fields: {}, facts: [], sourcesUsed: [], screenshots: [], blocked: [], sourceUrls: [], note: 'parcel read',
      inspection: { parcelUrl: 'https://landportal.example/parcel', comparablesUrl: null, parcelFacts: { 'Owner Name': 'DOE', 'Parcel ID': 'R123', Acres: '10' }, assets: [], overlays: [], visualObservations: [], comparables: [] },
    } satisfies BrowserEvidence;
    const budgets: number[] = [];
    const landPortalService: BrowserService = {
      ...fakeService(landportal),
      async runWorkflow(_input, options) { budgets.push(options.timeoutMs); return landportal; },
    };
    await runPropertyInspection({
      searchKey: { address: '1 Main St', county: 'Example', state: 'TX' },
      mode: 'deep_record',
      timeoutMs: 1_000,
    }, { landPortalBrowser: landPortalService, googleVisualConfigured: false });

    expect(budgets).toEqual([1_000]);
  });

  it('does not let Google visual capture overrun an exhausted identity deadline', async () => {
    const landportal = {
      service: 'landportal', mode: 'workflow', status: 'retrieved', patch: {}, fields: {}, facts: [], sourcesUsed: [], screenshots: [], blocked: [], sourceUrls: [], note: 'parcel read',
      inspection: { parcelUrl: 'https://landportal.example/parcel', comparablesUrl: null, parcelFacts: { 'Owner Name': 'DOE', 'Parcel ID': 'R123', Acres: '10' }, assets: [], overlays: [], visualObservations: [], comparables: [] },
    } satisfies BrowserEvidence;
    let clock = 1_000;
    let captureCalls = 0;
    const landPortalService: BrowserService = {
      ...fakeService(landportal),
      async runWorkflow() {
        clock += 1_100;
        return landportal;
      },
    };

    const result = await runPropertyInspection({
      cardId: 7,
      searchKey: { address: '1 Main St', county: 'Example', state: 'TX' },
      timeoutMs: 1_000,
    }, {
      landPortalBrowser: landPortalService,
      googleVisualConfigured: true,
      captureVisuals: async () => {
        captureCalls += 1;
        return { ok: true, cardId: 7, reason: 'captured', captured: ['maps_static'] };
      },
      nowMs: () => clock,
    });

    expect(captureCalls).toBe(0);
    expect(result.routes.find((route) => route.provider === 'Google Maps / Satellite / Street View')).toMatchObject({
      status: 'partial',
      note: expect.stringMatching(/deadline was exhausted/i),
    });
  });

  it('quarantines implausible frontage and extreme terrain values when retained imagery conflicts or was never interpreted', async () => {
    const landportal = {
      service: 'landportal', mode: 'workflow', status: 'retrieved', patch: {}, fields: {}, facts: [], sourcesUsed: [], screenshots: [], blocked: [], sourceUrls: [], note: 'parcel read',
      inspection: {
        parcelUrl: 'https://landportal.example/parcel',
        comparablesUrl: null,
        parcelFacts: {
          'Owner Name': 'DOE',
          'Parcel ID': 'R123',
          Acres: '52.84',
          'Road Frontage': '1,304 ft',
          'Slope Avg': '53.57 %',
          'Slope Max': '228.33 %',
          'Buildability total (%)': '0.28 %',
          'Buildability area (acres)': '0.15 ac.',
        },
        assets: [{ key: 'terrain', label: 'Terrain', kind: 'parcel_3d', purpose: 'terrain', sourcePath: 'terrain.png', timestamp: '2026-07-29T12:00:00.000Z' }],
        overlays: [],
        visualObservations: [
          { label: 'Road frontage', detail: 'Imagery shows an approximately 50 ft narrow road neck.', confidence: 'medium', evidence: 'Parcel boundary and aerial' },
          { label: 'Terrain', detail: 'The retained aerial appears rolling to moderately sloped rather than uniformly extreme.', confidence: 'medium', evidence: 'Aerial and terrain imagery' },
        ],
        comparables: [],
      },
    } satisfies BrowserEvidence;
    const result = await runPropertyInspection({
      searchKey: { address: '1 Highway 11', county: 'Example', state: 'SC' },
      existingEvidence: [landportal],
      timeoutMs: 1000,
    }, { landPortalBrowser: fakeService(landportal), googleVisualConfigured: false });

    expect(result.inspection.parcelFacts['Road Frontage']).not.toMatch(/\d/);
    // The DECISION slot carries no number a reader could parse.
    expect(result.inspection.parcelFacts['Slope Avg']).not.toMatch(/\d/);
    expect(result.inspection.parcelFacts['Buildability total (%)']).not.toMatch(/\d/);
    // The OBSERVATION survives under its own companion key, so the operator can
    // still be told what the provider reported and why it is not being relied
    // on. Quarantine withholds a number from decisions; it never deletes it.
    expect(result.inspection.parcelFacts['Slope Avg (provider observation)']).toBe('53.57 %');
    expect(result.inspection.parcelFacts['Buildability total (%) (provider observation)']).toBe('0.28 %');
    expect(result.inspection.parcelFacts['Terrain Quarantine Reason']).toMatch(/average slope 53\.57%/);
    expect(result.inspection.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Road frontage conflict', status: 'needs_verification' }),
      expect.objectContaining({ label: 'Terrain and buildability conflict', status: 'needs_verification' }),
      expect.objectContaining({ label: 'Slope Avg (provider observation)', status: 'needs_verification', confidence: 'low' }),
    ]));
  });

  it('reconciles buildable area against ANY acreage basis the provider published', async () => {
    // The provider states an assessed acreage AND its own calculated acreage,
    // and runs its terrain model over the calculated one. Reconciling against
    // the assessed figure alone quarantined correct terrain output and then
    // destroyed it, which is how a 30.52% buildability that reconciles exactly
    // against 50.69 calculated acres was reported as unsupplied.
    const landportal = {
      service: 'landportal', mode: 'workflow', status: 'retrieved', patch: {}, fields: {}, facts: [], sourcesUsed: [], screenshots: [], blocked: [], sourceUrls: [], note: 'parcel read',
      inspection: {
        parcelUrl: 'https://landportal.example/parcel',
        comparablesUrl: null,
        parcelFacts: {
          'Parcel ID': 'R900',
          Acres: '75.91',
          'Calc Acres': '50.69',
          'Slope Avg': '18.65 %',
          'Buildability total (%)': '30.52 %',
          'Buildability area (acres)': '15.49 ac.',
        },
        assets: [], overlays: [], visualObservations: [], comparables: [],
      },
    } satisfies BrowserEvidence;
    const result = await runPropertyInspection({
      searchKey: { address: '1 Kingwood Blvd', county: 'Williamson', state: 'TN' },
      existingEvidence: [landportal],
      timeoutMs: 1000,
    }, { landPortalBrowser: fakeService(landportal), googleVisualConfigured: false });

    expect(result.inspection.parcelFacts['Slope Avg']).toBe('18.65 %');
    expect(result.inspection.parcelFacts['Buildability total (%)']).toBe('30.52 %');
    expect(result.inspection.parcelFacts['Buildability area (acres)']).toBe('15.49 ac.');
    expect(result.inspection.parcelFacts['Terrain Quarantine Reason']).toBeUndefined();
  });

  it('preserves extreme terrain values only when a medium/high-confidence visual interpretation corroborates them', async () => {
    const landportal = {
      service: 'landportal', mode: 'workflow', status: 'retrieved', patch: {}, fields: {}, facts: [], sourcesUsed: [], screenshots: [], blocked: [], sourceUrls: [], note: 'parcel read',
      inspection: {
        parcelUrl: 'https://landportal.example/parcel',
        comparablesUrl: null,
        parcelFacts: {
          'Owner Name': 'DOE', 'Parcel ID': 'R123', Acres: '50',
          'Slope Avg': '42 %', 'Slope Max': '75 %',
          'Buildability total (%)': '4 %', 'Buildability area (acres)': '2 ac.',
        },
        assets: [],
        overlays: [],
        visualObservations: [{ label: 'Terrain and contours', detail: 'The parcel is visibly steep across most of the retained terrain frame.', confidence: 'medium', evidence: '3D terrain and contour imagery' }],
        comparables: [],
      },
    } satisfies BrowserEvidence;
    const result = await runPropertyInspection({
      searchKey: { address: '1 Ridge Rd', county: 'Example', state: 'SC' },
      existingEvidence: [landportal],
      timeoutMs: 1000,
    }, { landPortalBrowser: fakeService(landportal), googleVisualConfigured: false });
    expect(result.inspection.parcelFacts['Slope Avg']).toBe('42 %');
    expect(result.inspection.parcelFacts['Buildability total (%)']).toBe('4 %');
    expect(result.inspection.evidence?.some((row) => row.label === 'Terrain and buildability conflict')).toBe(false);
  });
});
