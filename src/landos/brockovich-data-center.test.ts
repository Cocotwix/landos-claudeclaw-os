import { describe, expect, it, vi } from 'vitest';
import type { BrowserDriver } from './browser-intelligence.js';
import {
  BROCKOVICH_MAP_URL,
  brockovichDistanceMiles,
  classifyBrockovichStatus,
  runBrockovichDataCenterMap,
} from './brockovich-data-center.js';

function driver(read: unknown): BrowserDriver {
  return {
    id: 'brockovich-test',
    configured: () => true,
    open: vi.fn(async (url: string) => ({ url, fields: {}, snippets: [] })),
    search: vi.fn(),
    readFields: vi.fn(),
    screenshot: vi.fn(async (purpose: string) => ({ path: 'C:/tmp/brockovich.png', purpose, capturedAtIso: '2026-07-28T00:00:00.000Z' })),
    evaluate: vi.fn(async () => read),
  } as unknown as BrowserDriver;
}

describe('Brockovich data-center browser map', () => {
  it('requires subject coordinates before opening the map', async () => {
    const fake = driver({});
    const result = await runBrockovichDataCenterMap({ driver: fake });
    expect(result.status).toBe('not_run');
    expect(fake.open).not.toHaveBeenCalled();
  });

  it('retains only projects proven within 20 miles and returns the map screenshot', async () => {
    const fake = driver({
      mapReady: true,
      centered: true,
      subjectMarked: true,
      centersParsed: true,
      markers: [
        { title: 'Near Campus', operatorOrDeveloper: 'Example Energy', location: 'Pickens, SC', text: 'Under Construction with citation', href: 'https://source.test/near', lat: 34.81, lng: -82.49 },
        { title: 'Far Campus', text: 'Proposed', href: 'https://source.test/far', lat: 35.5, lng: -82.5 },
        { title: 'No-coordinate pin', text: 'Operational', href: null, lat: null, lng: null },
      ],
    });
    const result = await runBrockovichDataCenterMap({
      lat: 34.8, lng: -82.5, driver: fake, nowIso: '2026-07-28T00:00:00.000Z',
    });
    expect(fake.open).toHaveBeenCalledWith(BROCKOVICH_MAP_URL, expect.any(Object));
    expect(result.status).toBe('found');
    expect(result.projects).toHaveLength(1);
    expect(result.projects[0]).toMatchObject({
      title: 'Near Campus',
      status: 'under_construction',
      operatorOrDeveloper: 'Example Energy',
      location: 'Pickens, SC',
    });
    expect(result.screenshotPath).toBe('C:/tmp/brockovich.png');
  });

  it('does not accept a generated radius/grid fallback as Brockovich map evidence', async () => {
    const fake = driver({
      mapReady: true,
      centered: true,
      subjectMarked: true,
      centersParsed: true,
      syntheticFallback: true,
      markers: [],
    });
    const result = await runBrockovichDataCenterMap({ lat: 34.8, lng: -82.5, driver: fake });
    expect(result.status).toBe('unavailable');
    expect(result.screenshotPath).toBeNull();
    expect(result.note).toMatch(/generated radius screen.*not accepted as map proof/i);
  });

  it('distinguishes project states and calculates geographic distance', () => {
    expect(classifyBrockovichStatus('Community Reported')).toBe('community_reported');
    expect(classifyBrockovichStatus('Operational')).toBe('operational');
    expect(brockovichDistanceMiles({ lat: 34.8, lng: -82.5 }, { lat: 34.81, lng: -82.51 })).toBeLessThan(1);
  });
});
