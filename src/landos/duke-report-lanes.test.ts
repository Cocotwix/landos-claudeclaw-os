// Tests for the Default Duke Report Source Lanes v1. Pure: no network, no
// agent, no tokens, no comp credits.

import { describe, it, expect } from 'vitest';

import {
  buildDukeReportLanes,
  buildCountyDeepDivePlaceholder,
  renderDukeReportLanes,
  selectPreferredMarketCount,
  LANDPORTAL_VERIFICATION_TIMEOUT_MS,
  LANDWATCH_MIN_ACRES,
  LOCAL_AREA_NOT_VERIFIED_LABEL,
  MARKET_COUNT_UNAVAILABLE_SOURCE,
  MARKET_COUNT_SOURCE_PRIORITY,
  type DukeReportLanesInput,
} from './duke-report-lanes.js';

const baseInput = (over: Partial<DukeReportLanesInput> = {}): DukeReportLanesInput => ({
  landPortal: { status: 'not_verified', verified: false },
  compMode: 'redfin_zillow',
  ...over,
});
const laneOf = (r: ReturnType<typeof buildDukeReportLanes>, id: string) => r.lanes.find(l => l.laneId === id)!;

describe('LandPortal verification ceiling', () => {
  it('is exactly 3 minutes', () => {
    expect(LANDPORTAL_VERIFICATION_TIMEOUT_MS).toBe(3 * 60 * 1000);
  });
});

describe('LandPortal timeout does not collapse the report', () => {
  const r = buildDukeReportLanes(baseInput({
    landPortal: { status: 'timeout', verified: false, reason: 'LandPortal lookup did not respond in time.' },
    localAreaAnchor: 'Clay County, TN',
  }));

  it('LandPortal lane status = timeout', () => {
    expect(laneOf(r, 'landportal_exact_search').status).toBe('timeout');
  });
  it('parcel is not verified and labeled Local Area Context, Not Parcel Verified', () => {
    expect(r.parcelVerified).toBe(false);
    expect(r.unverifiedLabel).toBe(LOCAL_AREA_NOT_VERIFIED_LABEL);
    expect(r.summary).toContain(LOCAL_AREA_NOT_VERIFIED_LABEL);
  });
  it('Local Area Data lane still contributes compact context (not thin)', () => {
    const la = laneOf(r, 'local_area_data');
    expect(la.status).toBe('success');
    expect(la.findings.some(f => /Clay County, TN/.test(f))).toBe(true);
    expect(la.findings).toContain(LOCAL_AREA_NOT_VERIFIED_LABEL);
  });
  it('downstream lanes are blocked, not scored', () => {
    expect(laneOf(r, 'redfin_zillow_comps').status).toBe('blocked');
    expect(laneOf(r, 'landwatch').status).toBe('blocked');
    expect(laneOf(r, 'strategy_offer').status).toBe('blocked');
  });
});

describe('Verification Captain authority is exact-only', () => {
  it('only LandPortal/verification lanes carry parcelVerificationAuthority', () => {
    const r = buildDukeReportLanes(baseInput({ landPortal: { status: 'success', verified: true, identitySummary: 'APN 08-2518, FIPS 37061' }, acres: 10 }));
    const authority = r.lanes.filter(l => l.parcelVerificationAuthority).map(l => l.laneId).sort();
    expect(authority).toEqual(['landportal_exact_search', 'verification_captain']);
    // Market/context lanes can never verify identity.
    for (const id of ['local_area_data', 'redfin_zillow_comps', 'landwatch', 'strategy_offer']) {
      expect(laneOf(r, id).canVerifyParcel).toBe(false);
      expect(laneOf(r, id).verifiedParcelIdentity).toBe(false);
    }
  });

  it('does not verify from local area / redfin / zillow / landwatch even if LandPortal failed', () => {
    const r = buildDukeReportLanes(baseInput({ landPortal: { status: 'not_verified', verified: false }, localAreaAnchor: 'Clay County, TN' }));
    expect(r.parcelVerified).toBe(false);
    expect(laneOf(r, 'verification_captain').verifiedParcelIdentity).toBe(false);
  });
});

describe('Verified parcel enables gated lanes', () => {
  it('Redfin/Zillow comps are eligible (not blocked) once verified', () => {
    const r = buildDukeReportLanes(baseInput({ landPortal: { status: 'success', verified: true }, acres: 10 }));
    expect(laneOf(r, 'redfin_zillow_comps').status).not.toBe('blocked');
    expect(laneOf(r, 'strategy_offer').status).toBe('success');
  });

  it('strategy lane preserves distinct bands + min net profit ($10k / $30k)', () => {
    const r = buildDukeReportLanes(baseInput({ landPortal: { status: 'success', verified: true }, acres: 5 }));
    const s = laneOf(r, 'strategy_offer');
    expect(s.findings.join(' ')).toMatch(/\$10,000/);
    expect(s.findings.join(' ')).toMatch(/\$30,000/);
    expect(s.findings.join(' ')).toMatch(/% of EV/);
  });
});

describe('LandWatch over-50-acre gate', () => {
  it('blocked when parcel unverified', () => {
    expect(laneOf(buildDukeReportLanes(baseInput({ acres: 100 })), 'landwatch').status).toBe('blocked');
  });
  it('skipped when verified acreage is 50 or less', () => {
    const r = buildDukeReportLanes(baseInput({ landPortal: { status: 'success', verified: true }, acres: LANDWATCH_MIN_ACRES }));
    const lw = laneOf(r, 'landwatch');
    expect(lw.status).toBe('skipped');
    expect(lw.blockingReason).toMatch(/threshold not met/i);
  });
  it('eligible (not skipped/blocked) when verified acreage is over 50', () => {
    const r = buildDukeReportLanes(baseInput({ landPortal: { status: 'success', verified: true }, acres: 51 }));
    expect(['not_available', 'success']).toContain(laneOf(r, 'landwatch').status);
  });
});

describe('No comp credits, no verification-by-market-site, no map/coordinate language', () => {
  it('compCreditUsed is false on every lane and overall', () => {
    const r = buildDukeReportLanes(baseInput({ landPortal: { status: 'success', verified: true }, acres: 60 }));
    expect(r.compCreditUsed).toBe(false);
    expect(r.lanes.every(l => l.compCreditUsed === false)).toBe(true);
  });
  it('emits no coordinate/geocoder/proximity/map-pin/visual verification language', () => {
    const variants = [
      buildDukeReportLanes(baseInput({ landPortal: { status: 'timeout', verified: false }, localAreaAnchor: 'Clay County, TN' })),
      buildDukeReportLanes(baseInput({ landPortal: { status: 'success', verified: true }, acres: 80 })),
    ];
    for (const r of variants) {
      expect(/geocod|proximity|nearest parcel|map pin|coordinate|street view|satellite|map bounds/i.test(JSON.stringify(r))).toBe(false);
    }
  });
});

describe('renderDukeReportLanes (compact dashboard report)', () => {
  it('leads with Local Area Context label and lists lane statuses on timeout', () => {
    const out = renderDukeReportLanes(buildDukeReportLanes(baseInput({
      landPortal: { status: 'timeout', verified: false, reason: 'LandPortal lookup did not respond in time.' },
      localAreaAnchor: 'Clay County, TN',
    })));
    expect(out).toContain(LOCAL_AREA_NOT_VERIFIED_LABEL);
    expect(out).toMatch(/LandPortal Exact Search: timeout/);
    expect(out).toMatch(/Local Area Data: success/);
    expect(out).toMatch(/Clay County, TN/);
    expect(out).toMatch(/Strategy \/ Offer: blocked/);
  });
  it('renders a verified parcel header and no Local Area Context label', () => {
    const out = renderDukeReportLanes(buildDukeReportLanes(baseInput({
      landPortal: { status: 'success', verified: true, identitySummary: 'APN 08-2518, FIPS 37061' }, acres: 10,
    })));
    expect(out).toMatch(/parcel VERIFIED \(APN 08-2518, FIPS 37061\)/);
    expect(out).not.toContain(LOCAL_AREA_NOT_VERIFIED_LABEL);
  });
  it('emits no coordinate/geocoder/proximity/map-pin/visual verification language', () => {
    const out = renderDukeReportLanes(buildDukeReportLanes(baseInput({
      landPortal: { status: 'timeout', verified: false }, localAreaAnchor: 'Clay County, TN',
    })));
    expect(/geocod|proximity|nearest parcel|map pin|coordinate|street view|satellite/i.test(out)).toBe(false);
  });
});

describe('Local Area Data — compact unverified market snapshot', () => {
  const localFindings = (over: Partial<DukeReportLanesInput> = {}) =>
    laneOf(buildDukeReportLanes(baseInput({ localAreaAnchor: 'Clay County, TN', ...over })), 'local_area_data').findings;
  const joined = (over: Partial<DukeReportLanesInput> = {}) => localFindings(over).join('\n');

  it('leads with the exact "Local Area Context, Not Parcel Verified" label and the area name', () => {
    const f = localFindings();
    expect(f[0]).toBe(LOCAL_AREA_NOT_VERIFIED_LABEL);
    expect(f.some(x => /^Area: Clay County, TN$/.test(x))).toBe(true);
  });

  it('includes an annual growth field — unavailable placeholder when no data', () => {
    expect(joined()).toMatch(new RegExp(`Annual growth: unavailable \\| Source: ${MARKET_COUNT_UNAVAILABLE_SOURCE}`));
  });

  it('annual growth labels TYPE and source when available (population)', () => {
    const out = joined({ localAreaMarket: { annualGrowth: { value: 1.8, type: 'population', source: 'Census / cached source' } } });
    expect(out).toMatch(/Annual population growth: 1\.8% \| Source: Census \/ cached source/);
    expect(out).not.toMatch(/Annual growth: unavailable/);
  });

  it('annual growth labels market-price type + source when supplied', () => {
    const out = joined({ localAreaMarket: { annualGrowth: { value: 4.2, type: 'market_price', source: 'Zillow' } } });
    expect(out).toMatch(/Annual market price growth: 4\.2% \| Source: Zillow/);
  });

  it('includes active + sold land count fields with unavailable placeholders by default', () => {
    const out = joined();
    expect(out).toMatch(/Active land listings: unavailable/);
    expect(out).toMatch(new RegExp(`Active land listings source: ${MARKET_COUNT_UNAVAILABLE_SOURCE}`));
    expect(out).toMatch(/Land sold last 6 months: unavailable/);
    expect(out).toMatch(new RegExp(`Land sold last 6 months source: ${MARKET_COUNT_UNAVAILABLE_SOURCE}`));
    expect(out).toMatch(/Source status: not_available/);
  });

  it('every supplied count carries its source; Redfin/Zillow are preferred labels', () => {
    const out = joined({
      localAreaMarket: {
        activeLandListings: { count: 14, source: 'Redfin' },
        soldLandLast6Months: { count: 6, source: 'Zillow' },
      },
    });
    expect(out).toMatch(/Active land listings: 14/);
    expect(out).toMatch(/Active land listings source: Redfin/);
    expect(out).toMatch(/Land sold last 6 months: 6/);
    expect(out).toMatch(/Land sold last 6 months source: Zillow/);
    expect(out).toMatch(/Source status: success/);
  });

  it('supports fallback source labels without pretending they are Redfin/Zillow', () => {
    const out = joined({
      localAreaMarket: {
        activeLandListings: { count: 9, source: 'local MLS public search' },
        soldLandLast6Months: { count: 3, source: 'LandWatch market listings' },
      },
    });
    expect(out).toMatch(/Active land listings source: local MLS public search/);
    expect(out).toMatch(/Land sold last 6 months source: LandWatch market listings/);
    expect(out).not.toMatch(/source: Redfin/);
    expect(out).not.toMatch(/source: Zillow/);
  });

  it('partial data yields a partial source status, not a fabricated count', () => {
    const out = joined({ localAreaMarket: { activeLandListings: { count: 4, source: 'Redfin' } } });
    expect(out).toMatch(/Active land listings: 4/);
    expect(out).toMatch(/Land sold last 6 months: unavailable/);
    expect(out).toMatch(/Source status: partial/);
  });

  it('marks a blended count explicitly with all sources listed', () => {
    const out = joined({
      localAreaMarket: { activeLandListings: { count: 20, source: 'blended', blended: true, blendedSources: ['Redfin', 'Zillow'] } },
    });
    expect(out).toMatch(/Active land listings: 20 \(blended count\)/);
    expect(out).toMatch(/Active land listings source: blended — Redfin, Zillow/);
  });

  it('never invents a count: no bare digits appear in any unavailable count field', () => {
    const f = localFindings();
    const countLines = f.filter(x => /(Active land listings|Land sold last 6 months):/.test(x));
    for (const line of countLines) expect(line).toMatch(/: unavailable$/);
  });

  it('an unverified report produces no score/value/offer/strategy/comp conclusion', () => {
    const r = buildDukeReportLanes(baseInput({ localAreaAnchor: 'Clay County, TN' }));
    expect(r.parcelVerified).toBe(false);
    expect(laneOf(r, 'strategy_offer').status).toBe('blocked');
    expect(laneOf(r, 'strategy_offer').findings).toEqual([]);
    expect(laneOf(r, 'redfin_zillow_comps').status).toBe('blocked');
    const rendered = renderDukeReportLanes(r);
    expect(rendered).not.toMatch(/worth \$|Expected Value \$|offer \$|% of EV/i);
  });

  it('does not emit the old "full Fast Default report" wording', () => {
    const rendered = renderDukeReportLanes(buildDukeReportLanes(baseInput({ localAreaAnchor: 'Clay County, TN' })));
    expect(rendered).not.toMatch(/full Fast Default report/i);
    expect(rendered).not.toMatch(/Want the full report/i);
  });

  it('market sources can never verify identity (Redfin/Zillow/LandWatch/Realtor.com)', () => {
    const r = buildDukeReportLanes(baseInput({
      localAreaAnchor: 'Clay County, TN',
      localAreaMarket: {
        activeLandListings: { count: 14, source: 'Redfin' },
        soldLandLast6Months: { count: 6, source: 'LandWatch market listings' },
      },
    }));
    expect(r.parcelVerified).toBe(false);
    expect(laneOf(r, 'local_area_data').canVerifyParcel).toBe(false);
    expect(laneOf(r, 'local_area_data').verifiedParcelIdentity).toBe(false);
    expect(laneOf(r, 'verification_captain').verifiedParcelIdentity).toBe(false);
  });

  it('emits no coordinate/geocoder/proximity/map-pin/visual language with market data present', () => {
    const r = buildDukeReportLanes(baseInput({
      localAreaAnchor: 'Clay County, TN',
      localAreaMarket: { activeLandListings: { count: 14, source: 'Redfin' }, annualGrowth: { value: 2, type: 'population', source: 'Census' } },
    }));
    expect(/geocod|proximity|nearest parcel|map pin|coordinate|street view|satellite|centroid/i.test(JSON.stringify(r))).toBe(false);
  });
});

describe('selectPreferredMarketCount — Redfin > Zillow > local/public order', () => {
  it('picks the highest-priority real count regardless of input order', () => {
    const got = selectPreferredMarketCount([
      { source: 'LandWatch market listings', count: 3 },
      { source: 'Redfin', count: 11 },
      { source: 'Zillow', count: 8 },
    ]);
    expect(got).toEqual({ count: 11, source: 'Redfin' });
  });

  it('falls back to a labeled local/public source without pretending it is Redfin/Zillow', () => {
    const got = selectPreferredMarketCount([{ source: 'local MLS public search', count: 7 }]);
    expect(got).toEqual({ count: 7, source: 'local MLS public search' });
  });

  it('returns unavailable (never invents) when no usable count is supplied', () => {
    expect(selectPreferredMarketCount([])).toEqual({ count: null, source: MARKET_COUNT_UNAVAILABLE_SOURCE });
    expect(selectPreferredMarketCount([{ source: 'Redfin', count: null }])).toEqual({ count: null, source: MARKET_COUNT_UNAVAILABLE_SOURCE });
  });

  it('priority list keeps Redfin and Zillow ahead of fallbacks', () => {
    expect(MARKET_COUNT_SOURCE_PRIORITY[0]).toBe('Redfin');
    expect(MARKET_COUNT_SOURCE_PRIORITY[1]).toBe('Zillow');
    expect(MARKET_COUNT_SOURCE_PRIORITY).toContain('LandWatch market listings');
  });
});

describe('County Deep Dive is on-demand only', () => {
  it('is not one of the default report lanes', () => {
    const r = buildDukeReportLanes(baseInput({ landPortal: { status: 'success', verified: true }, acres: 10 }));
    expect(r.lanes.some(l => l.laneId === 'county_deep_dive')).toBe(false);
  });
  it('placeholder is structured, not run by default, and verifies nothing', () => {
    const dd = buildCountyDeepDivePlaceholder();
    expect(dd.status).toBe('not_available');
    expect(dd.canVerifyParcel).toBe(false);
    expect(dd.nextAction).toMatch(/never run by default/i);
  });
});
