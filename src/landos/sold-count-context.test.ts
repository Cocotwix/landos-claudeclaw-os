// Sold-count market context. Pure + deterministic: no live network, no paid
// APIs, no comp tools, no secrets, no parcel verification.

import { describe, expect, it } from 'vitest';

import { buildOfficialSources } from './official-sources.js';
import {
  acreageBand,
  buildSoldCountContext,
  freeBrowserSoldCountAdapter,
  rollingTwelveMonthWindow,
} from './sold-count-context.js';

describe('rolling 12-month window', () => {
  it('uses the runtime date and keeps a 12-month lookback window', () => {
    const window = rollingTwelveMonthWindow('2026-06-18T12:34:56.000Z');
    expect(window.start).toBe('2025-06-18');
    expect(window.end).toBe('2026-06-18');
    expect(window.label).toBe('Rolling 12 months from run date');
    expect(window.runtimeDate).toBe('2026-06-18T12:34:56.000Z');
  });

  it('bands acreage for sold-search assumptions', () => {
    expect(acreageBand(0.5)).toBe('0-1 ac');
    expect(acreageBand(7)).toBe('5-10 ac');
    expect(acreageBand(55)).toBe('50+ ac');
  });
});

describe('sold-count context', () => {
  it('builds Redfin/Zillow/Realtor links after parcel verification with local-area labels', async () => {
    const officialSources = buildOfficialSources({ county: 'Coffee', state: 'TN', parcelVerified: true });
    const ctx = await buildSoldCountContext({
      city: 'Manchester',
      county: 'Coffee',
      state: 'TN',
      parcelVerified: true,
      acres: 12.5,
      officialSources,
      now: '2026-06-18T12:34:56.000Z',
      browserAutomationAvailable: true,
    });

    expect(ctx.label).toBe('Local Area Context, Not Parcel Verification');
    expect(ctx.status).toBe('browser_assisted_available');
    expect(ctx.browserAutomationStatus).toBe('free_browser_automation_available');
    expect(ctx.freeBrowserAutomationAvailable).toBe(true);
    expect(ctx.lookbackStart).toBe('2025-06-18');
    expect(ctx.lookbackEnd).toBe('2026-06-18');
    expect(ctx.lookbackLabel).toBe('Rolling 12 months from run date');
    expect(ctx.searchArea).toBe('Coffee County, TN');
    expect(ctx.acreageBand).toBe('10-20 ac');
    expect(ctx.links).toHaveLength(3);
    expect(ctx.links[0].url).toMatch(/redfin\.com/);
    expect(ctx.links[1].url).toMatch(/zillow\.com/);
    expect(ctx.links[2].url).toMatch(/realtor\.com/);
    expect(ctx.captureDraft.capturedAt).toBe('2026-06-18T12:34:56.000Z');
    expect(ctx.reportReadySummary).toMatch(/Embedded similar sales available/i);
    expect(ctx.reportReadySummary).toMatch(/free browser-assisted capture|manual capture/i);
    expect(ctx.reportReadySummary).toMatch(/rolling 12-month/i);
    expect(ctx.reportReadySummary).toMatch(/No paid subscription or paid API is used/i);
    expect(ctx.note).toMatch(/Local Area Context, Not Parcel Verification/);
    expect(ctx.openDataFallbacks.some((slot) => slot.id === 'county_sales_records' && slot.status === 'data_gap')).toBe(true);
  });

  it('builds local-area sold-count context from city/state even without parcel verification', async () => {
    const ctx = await buildSoldCountContext({
      city: 'Manchester',
      state: 'TN',
      parcelVerified: false,
      acres: 12.5,
      now: '2026-06-18T12:34:56.000Z',
      browserAutomationAvailable: true,
    });

    expect(ctx.status).toBe('browser_assisted_available');
    expect(ctx.links).toHaveLength(3);
    expect(ctx.searchArea).toBe('Manchester, TN');
    expect(ctx.reportReadySummary).toMatch(/Local Area Context/i);
    expect(ctx.reportReadySummary).toMatch(/rolling 12-month/i);
    expect(ctx.captureDraft.redfinCount).toBe('');
    expect(ctx.captureDraft.zillowCount).toBe('');
  });

  it('labels acreage unknown until a manual acreage override is provided', async () => {
    const ctx = await buildSoldCountContext({
      city: 'Manchester',
      state: 'TN',
      parcelVerified: false,
      acres: null,
      now: '2026-06-18T12:34:56.000Z',
      browserAutomationAvailable: true,
    });

    expect(ctx.acreage).toBeNull();
    expect(ctx.acreageBand).toBe('unknown acreage band');
    expect(ctx.acreageOverrideActive).toBe(true);
    expect(ctx.reportReadySummary).toMatch(/Acreage unknown until parcel facts or a manual acreage override is provided/i);
  });

  it('stays a data gap when there is not enough area context to build links', async () => {
    const ctx = await buildSoldCountContext({
      state: 'TN',
      parcelVerified: false,
      acres: 12.5,
      now: '2026-06-18T12:34:56.000Z',
      browserAutomationAvailable: true,
    });

    expect(ctx.status).toBe('data_gap');
    expect(ctx.links).toHaveLength(0);
    expect(ctx.searchArea).toBe('TN');
  });

  it('uses manual_capture_ready when parcel verification exists but browser automation is unavailable', async () => {
    const ctx = await buildSoldCountContext({
      city: 'Manchester',
      county: 'Coffee',
      state: 'TN',
      parcelVerified: true,
      acres: 12.5,
      now: '2026-06-18T12:34:56.000Z',
      browserAutomationAvailable: false,
    });

    expect(ctx.status).toBe('manual_capture_ready');
    expect(ctx.browserAutomationStatus).toBe('automation_blocked_needs_package_approval');
    expect(ctx.links.length).toBeGreaterThan(0);
  });
});

describe('free browser sold-count adapter', () => {
  it('captures a visible sold count when the page exposes one', async () => {
    const result = await freeBrowserSoldCountAdapter(
      {
        provider: 'Redfin',
        sourceUrl: 'https://example.com/sold-search',
        searchArea: 'Coffee County, TN',
        acreageBand: '10-20 ac',
        lookbackStart: '2025-06-18',
        lookbackEnd: '2026-06-18',
        lookbackLabel: 'Rolling 12 months from run date',
      },
      {
        now: '2026-06-18T12:34:56.000Z',
        browserLauncher: async () => ({
          newPage: async () => ({
            goto: async () => undefined,
            evaluate: async () => 'Sold 12 results found in the selected area.',
            close: async () => undefined,
          }),
          close: async () => undefined,
        }),
      },
    );

    expect(result.status).toBe('captured');
    expect(result.count).toBe(12);
    expect(result.capturedAt).toBe('2026-06-18');
  });

  it('falls back to manual capture when automation cannot read a count', async () => {
    const result = await freeBrowserSoldCountAdapter(
      {
        provider: 'Zillow',
        sourceUrl: 'https://example.com/sold-search',
        searchArea: 'Coffee County, TN',
        acreageBand: '10-20 ac',
        lookbackStart: '2025-06-18',
        lookbackEnd: '2026-06-18',
        lookbackLabel: 'Rolling 12 months from run date',
      },
      {
        now: '2026-06-18T12:34:56.000Z',
        browserLauncher: async () => ({
          newPage: async () => ({
            goto: async () => undefined,
            evaluate: async () => 'visible text with no readable count',
            close: async () => undefined,
          }),
          close: async () => undefined,
        }),
      },
    );

    expect(result.status).toBe('manual_capture_required');
    expect(result.count).toBeNull();
  });

  it('returns a safe approval-needed result when launch fails', async () => {
    const result = await freeBrowserSoldCountAdapter(
      {
        provider: 'Realtor',
        sourceUrl: 'https://example.com/sold-search',
        searchArea: 'Coffee County, TN',
        acreageBand: '10-20 ac',
        lookbackStart: '2025-06-18',
        lookbackEnd: '2026-06-18',
        lookbackLabel: 'Rolling 12 months from run date',
      },
      {
        now: '2026-06-18T12:34:56.000Z',
        browserLauncher: async () => {
          throw new Error('blocked');
        },
      },
    );

    expect(result.status).toBe('automation_blocked_needs_package_approval');
    expect(result.count).toBeNull();
  });
});
