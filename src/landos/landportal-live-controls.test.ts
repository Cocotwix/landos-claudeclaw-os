// Regression coverage for the LandPortal live-control catalog (proven 2026-07-30).
import { describe, expect, it } from 'vitest';

import {
  LP_SEARCH, LP_SIDEBAR, LP_MAP, LP_OVERLAYS, LP_COMPS,
  parseMarketCompsCardText, nyCompositeToLandPortalApn,
} from './landportal-live-controls.js';

describe('landportal live-control catalog', () => {
  it('records the proven search widget contract', () => {
    expect(LP_SEARCH.input).toBe('#main_search_input');
    expect(LP_SEARCH.modes.apn).toBe('parcelnumb');
    expect(LP_SEARCH.resultItem).toBe('li.search-variant');
    expect(LP_SEARCH.parcelUrlMarker.test('https://landportal.com/?property=abc')).toBe(true);
  });
  it('records the sidebar row and overlays-panel contracts', () => {
    expect(LP_SIDEBAR.rowTitle).toBe('.tab-row__title');
    expect(LP_OVERLAYS.card).toBe('button.lp-overlays__cardTop');
    // the legacy hidden checkbox panel is the recorded dead end, not a control
    expect(LP_OVERLAYS.deadEnd).toBe('.map-additional-wr');
    expect(LP_OVERLAYS.provenNames).toContain('Wetlands');
    expect(LP_OVERLAYS.provenNames).toContain('Soil Type');
  });
  it('records the comp surfaces and the real-click / new-tab facts', () => {
    expect(LP_COMPS.sidebarCard).toBe('.lp-estimate-comparable-card');
    expect(LP_COMPS.showOnMap).toBe('a.js-lp-estimate-show-on-map');
    expect(LP_COMPS.resultUrlMarker).toBe('market_comps=');
    expect(LP_MAP.toggle3d).toBe('button.lp-map-controls__toggle3d');
  });
});

describe('parseMarketCompsCardText', () => {
  // Exact live card text from Trial 1 (Morgan County TN).
  it('parses a live Trial 1 card', () => {
    const p = parseMarketCompsCardText('$39,900 Sold 158 Jess Ridge Rd, Morgan, TN, 37770 239,580 SqFt lot 5.50 MLS acres 05-22-2026 greathouse kelly');
    expect(p).toEqual({ price: 39900, sqftLot: 239580, mlsAcres: 5.5, soldDate: '05-22-2026', soldBy: 'greathouse kelly', status: 'sold' });
  });
  // Exact live card text from Trial 2 (Cayuga County NY).
  it('parses a live Trial 2 card', () => {
    const p = parseMarketCompsCardText('$217,000 Sold 12036 Old State Rd, Cayuga, NY, 13033 2,700,720 SqFt lot 62.00 MLS acres 07-16-2024 cedar creek land holdings');
    expect(p.price).toBe(217000);
    expect(p.mlsAcres).toBe(62);
    expect(p.soldDate).toBe('07-16-2024');
    expect(p.status).toBe('sold');
  });
  it('never fabricates a status from a bare price', () => {
    expect(parseMarketCompsCardText('$29,900 5.00 MLS acres').status).toBe('unknown');
  });
});

describe('nyCompositeToLandPortalApn', () => {
  // The exact Trial 2 case, proven live: composite → LandPortal's indexed key.
  it('decodes the Cayuga trial parcel', () => {
    expect(nyCompositeToLandPortalApn('053889-075-000-0001-024-011-0000')).toBe('053889 75.00-1-24.11');
  });
  it('drops a lot\'s .00 but keeps the section\'s (matches "053289 47.00-1-6")', () => {
    expect(nyCompositeToLandPortalApn('053289-047-000-0001-006-000-0000')).toBe('053289 47.00-1-6');
  });
  it('returns null for non-composite ids', () => {
    expect(nyCompositeToLandPortalApn('095 02405')).toBeNull();
    expect(nyCompositeToLandPortalApn('75.00-1-24.11')).toBeNull();
    expect(nyCompositeToLandPortalApn('')).toBeNull();
  });
});
