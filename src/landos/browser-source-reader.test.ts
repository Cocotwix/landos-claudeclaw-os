import { describe, expect, it, vi } from 'vitest';

import { createGovernedBrowserSourceReader, titleFromHtml } from './browser-source-reader.js';
import { browserEscalationLane } from './land-use-lanes.js';
import type { LandUseEvidence } from './land-use-source-race.js';
import type { GovFetchText, GovTextResponse } from './gis-transport.js';

function ok(body: string, via: GovTextResponse['via'] = 'server_fetch', url = 'https://www.fairview-tn.org/zoning'): GovTextResponse {
  return { status: 200, body, url, contentType: 'text/html', blocked: false, via };
}

const ZONING_PAGE = `<html><head><title>Fairview TN — Zoning Map</title></head>
  <body><h1>Official Zoning</h1><p>The subject parcel 042-123.00-000 lies within the R-20 district
  under the Development Code adopted April 2, 2026.</p></body></html>`;

describe('governed BrowserSourceReader', () => {
  it('reads an official page over the direct transport and returns text', async () => {
    const direct = vi.fn<GovFetchText>()
      .mockResolvedValue(ok(ZONING_PAGE));
    const browser = vi.fn<GovFetchText>();
    const read = createGovernedBrowserSourceReader({ direct, browser });

    const result = await read({ url: 'https://www.fairview-tn.org/zoning', purpose: 'current zoning', timeoutMs: 20_000 });

    expect(result?.title).toBe('Fairview TN — Zoning Map');
    expect(result?.text).toContain('042-123.00-000');
    expect(result?.text).toContain('R-20');
    // The direct route is always tried first; no tab is opened for a page that
    // answers a plain request.
    expect(browser).not.toHaveBeenCalled();
  });

  it('escalates into the governed browser only when the direct route is refused', async () => {
    const direct = vi.fn<GovFetchText>()
      .mockRejectedValue(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }));
    const browser = vi.fn<GovFetchText>()
      .mockResolvedValue(ok(ZONING_PAGE, 'background_browser'));
    const onEscalate = vi.fn();
    const read = createGovernedBrowserSourceReader({ direct, browser, onEscalate });

    const result = await read({ url: 'https://www.fairview-tn.org/zoning', purpose: 'current zoning', timeoutMs: 20_000 });

    expect(result?.text).toContain('R-20');
    expect(browser).toHaveBeenCalledOnce();
    expect(onEscalate).toHaveBeenCalledWith('https://www.fairview-tn.org/zoning');
  });

  it('reports an uncleared anti-bot challenge as no answer, never as page text', async () => {
    const direct = vi.fn<GovFetchText>()
      .mockResolvedValue({ ...ok('<html>Just a moment...</html>'), blocked: true });
    const browser = vi.fn<GovFetchText>()
      .mockResolvedValue({ ...ok('<html>Just a moment...</html>', 'background_browser'), blocked: true });
    const notes: string[] = [];
    const read = createGovernedBrowserSourceReader({ direct, browser, onNote: (n) => notes.push(n) });

    const result = await read({ url: 'https://records.example.gov', purpose: 'deed 9433/325', timeoutMs: 20_000 });

    expect(result).toBeNull();
    expect(notes.join(' ')).toMatch(/challenge that did not clear/);
  });

  it('returns null instead of throwing, so one dead source never fails the question', async () => {
    const direct = vi.fn<GovFetchText>()
      .mockRejectedValue(Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }));
    const browser = vi.fn<GovFetchText>();
    const read = createGovernedBrowserSourceReader({ direct, browser });

    await expect(
      read({ url: 'https://nope.invalid', purpose: 'zoning', timeoutMs: 5_000 }),
    ).resolves.toBeNull();
    // A host that does not resolve is not a refusal, so no tab is opened.
    expect(browser).not.toHaveBeenCalled();
  });

  it('treats a document with no readable text as no answer', async () => {
    const direct = vi.fn<GovFetchText>()
      .mockResolvedValue(ok('<html><body><div></div></body></html>'));
    const read = createGovernedBrowserSourceReader({ direct, browser: vi.fn() });
    await expect(read({ url: 'https://x.gov', purpose: 'zoning', timeoutMs: 5_000 })).resolves.toBeNull();
  });

  it('extracts a title only when the document carries one', () => {
    expect(titleFromHtml('<title>Williamson County Register of Deeds</title>'))
      .toBe('Williamson County Register of Deeds');
    expect(titleFromHtml('<html><body>no title</body></html>')).toBeNull();
  });
});

/** A minimal lane context: nothing else has released, no time has passed. */
const CTX = { elapsedMs: () => 0, released: () => false };

/** The district evidence a zoning reader would emit for the subject parcel. */
function districtEvidence(document: { url: string; text: string }): Array<LandUseEvidence<string>> {
  if (!document.text.includes('R-20')) return [];
  return [{
    method: 'browser_escalation',
    laneId: 'browser',
    value: 'R-20',
    authorityName: 'City of Fairview',
    sourceLabel: 'Fairview official zoning page',
    sourceUrl: document.url,
    sourceTier: 'municipal_primary' as LandUseEvidence<string>['sourceTier'],
    parcelMatchBasis: 'APN 042-123.00-000 named in the same passage as the district',
    currentness: 'current' as LandUseEvidence<string>['currentness'],
    effectiveOrAsOf: '2026-04-02',
    quote: 'lies within the R-20 district',
    retrievedAt: '2026-08-22T00:00:00.000Z',
  }];
}

describe('the escalation lane this reader repairs', () => {
  it('retrieved nothing while no reader was wired — the defect', async () => {
    const notes: string[] = [];
    const lane = browserEscalationLane<string>({
      urls: ['https://www.fairview-tn.org/zoning'],
      purpose: 'current zoning',
      jurisdiction: { municipality: 'Fairview', county: 'Williamson', state: 'TN' },
      read: districtEvidence,
      browser: null,
      onNote: (note) => notes.push(note),
    });

    await expect(lane.run({}, CTX)).resolves.toEqual([]);
    expect(notes.join(' ')).toMatch(/no browser reader is wired into this run/);
  });

  it('now retrieves evidence once the governed reader is supplied — the repair', async () => {
    const direct = vi.fn<GovFetchText>().mockResolvedValue(ok(ZONING_PAGE));
    const lane = browserEscalationLane<string>({
      urls: ['https://www.fairview-tn.org/zoning'],
      purpose: 'current zoning',
      jurisdiction: { municipality: 'Fairview', county: 'Williamson', state: 'TN' },
      read: districtEvidence,
      browser: createGovernedBrowserSourceReader({ direct, browser: vi.fn<GovFetchText>() }),
    });

    const found = await lane.run({}, CTX);
    expect(found).toHaveLength(1);
    expect(found[0].value).toBe('R-20');
    expect(found[0].sourceUrl).toContain('fairview-tn.org');
  });
});
