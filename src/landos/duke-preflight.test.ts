import { beforeEach, describe, expect, it, vi } from 'vitest';

import { extractPropertyArgs, looksLikePropertyInput, runDukePreflight } from './duke-preflight.js';
import type { LpResolveResult } from './landportal-client.js';

vi.mock('./landportal-client.js', () => ({
  lpResolveForPreflight: vi.fn(),
}));

import { lpResolveForPreflight } from './landportal-client.js';

const mockLp = lpResolveForPreflight as ReturnType<typeof vi.fn>;

// ── Fixture helpers ───────────────────────────────────────────────────────────

const VERIFIED: LpResolveResult = {
  verified: true,
  status: 'verified',
  propertyid: '123456',
  fips: '37005',
  apn: '12-345-678',
  situs_address: '731 Filter Plant Rd',
  city: 'Sparta',
  state: 'NC',
  owner: 'JOHN SMITH',
  match_notes: 'Parcel resolved via apn_search.',
  property_summary: {
    propertyid: '123456', apn: '12-345-678', situs_address: '731 Filter Plant Rd',
    city: 'Sparta', state: 'NC', zip: '28675', county: 'Alleghany',
    owner: 'JOHN SMITH', land_use: 'Vacant Land', lot_size_acres: '5.2',
    calc_acres: '5.2', lot_size_sqft: '226512', road_frontage_ft: '220',
    land_locked: '0', near_water: '0', wetlands_pct: '0', fema_pct: '2',
    buildability_pct: '87', buildability_acres: '4.52', slope_avg_deg: '8',
    elevation_avg_ft: '2800', building_area_sqft: '0', assessed_total: '45000',
    assessed_land: '45000', market_total: '55000', market_land: '55000',
    tlp_estimate: '62000', tlp_ppa: '11923', price_acre_county: '10500',
    lat: '36.5', lng: '-81.1', municipality: '', mailing_address: '123 Elm St',
    mailing_city: 'Sparta', mailing_state: 'NC', similars_count: '4',
    similars_ppa_min: '9000', similars_ppa_max: '13000',
    similars_ppa_median: '11000', similars_most_recent_year: '2024',
  } as LpResolveResult['property_summary'],
  candidates: [],
};

const TIMEOUT: LpResolveResult = {
  verified: false, status: 'lookup_timeout',
  propertyid: null, fips: null, apn: null, situs_address: null, owner: null,
  match_notes: 'LandPortal preflight fetch aborted after 10s.',
  candidates: [],
};

const NOT_VERIFIED: LpResolveResult = {
  verified: false, status: 'not_verified',
  propertyid: null, fips: null, apn: null, situs_address: null, owner: null,
  match_notes: 'No results found for this APN.',
  candidates: [],
};

const MULTIPLE: LpResolveResult = {
  verified: false, status: 'multiple_candidates',
  propertyid: null, fips: null, apn: null, situs_address: null, owner: null,
  match_notes: '3 parcels matched this APN. Ask Tyler to select the correct one.',
  candidates: [{ propertyid: '1', fips: '37005' }, { propertyid: '2', fips: '37005' }],
};

const AMBIGUOUS_FIPS: LpResolveResult = {
  verified: false, status: 'ambiguous_fips',
  propertyid: null, fips: null, apn: null, situs_address: null, owner: null,
  match_notes: 'County or FIPS required.',
  candidates: [],
};

beforeEach(() => {
  mockLp.mockReset();
});

// ── looksLikePropertyInput ────────────────────────────────────────────────────

describe('looksLikePropertyInput', () => {
  it('recognises the original failing input: 57 Church Road, Arnold MD', () => {
    expect(looksLikePropertyInput('57 Church Road, Arnold MD')).toBe(true);
  });

  it('recognises address with street type Rd', () => {
    expect(looksLikePropertyInput('731 Filter Plant Rd, Sparta, NC')).toBe(true);
  });

  it('recognises multi-word street name with Ave', () => {
    expect(looksLikePropertyInput('100 Old Mill Avenue, Chatham County, NC')).toBe(true);
  });

  it('recognises bare address without city/state', () => {
    expect(looksLikePropertyInput('57 Church Road')).toBe(true);
  });

  it('rejects area-only county query', () => {
    expect(looksLikePropertyInput('County stats for Chatham County, NC?')).toBe(false);
  });

  it('rejects follow-up query', () => {
    expect(looksLikePropertyInput('Add area stats to the previous report')).toBe(false);
  });

  it('rejects general question with a number', () => {
    expect(looksLikePropertyInput('What are the 5 main rubric factors?')).toBe(false);
  });

  it('rejects acreage phrase that looks address-adjacent', () => {
    expect(looksLikePropertyInput('12 acres in Chatham County NC')).toBe(false);
  });
});

// ── extractPropertyArgs ───────────────────────────────────────────────────────

describe('extractPropertyArgs', () => {
  it('extracts LP URL', () => {
    const r = extractPropertyArgs(
      'Check https://landportal.com/property?propertyid=12345&fips=37005 for me',
    );
    expect(r).toMatchObject({ lp_url: 'https://landportal.com/property?propertyid=12345&fips=37005' });
  });

  it('extracts APN with keyword (colon form)', () => {
    const r = extractPropertyArgs('Run DD on APN: 12-345-678, Alleghany County NC');
    expect(r).toMatchObject({ apn: '12-345-678', state: 'NC' });
  });

  it('extracts APN with keyword (space form)', () => {
    const r = extractPropertyArgs('APN 05-1234-0067 TX');
    expect(r).toMatchObject({ apn: '05-1234-0067', state: 'TX' });
  });

  it('extracts APN pattern without keyword', () => {
    const r = extractPropertyArgs('12-345-6789, Chatham County NC');
    expect(r).toMatchObject({ apn: '12-345-6789', state: 'NC' });
  });

  it('does not match date-like patterns as APN', () => {
    const r = extractPropertyArgs('Sold on 06-14-2026 in NC');
    expect(r).toBeNull();
  });

  it('extracts labeled propertyid + labeled fips', () => {
    const r = extractPropertyArgs('propertyid: 9876543 fips: 37005');
    expect(r).toMatchObject({ propertyid: '9876543', fips: '37005' });
  });

  it('returns null for area-only query with no identifier', () => {
    expect(extractPropertyArgs('What are the county stats for Chatham County, NC?')).toBeNull();
  });

  it('returns null for follow-up query', () => {
    expect(extractPropertyArgs('Add area stats to the previous report')).toBeNull();
  });

  it('returns null for a general question', () => {
    expect(extractPropertyArgs('What is the buildability threshold for a PURSUE verdict?')).toBeNull();
  });

  it('returns null for a plain address without county or fips', () => {
    // extractPropertyArgs returns null; runDukePreflight then blocks via looksLikePropertyInput
    expect(extractPropertyArgs('731 Filter Plant Rd, Sparta, NC')).toBeNull();
  });
});

// ── runDukePreflight ──────────────────────────────────────────────────────────

describe('runDukePreflight', () => {
  const ALLOWLIST = ['landportal', 'filesystem'];

  it('skips when no identifier found -- LP never called', async () => {
    const outcome = await runDukePreflight('County stats for Chatham County NC', ALLOWLIST, 10_000);
    expect(outcome.type).toBe('skip');
    expect(mockLp).not.toHaveBeenCalled();
  });

  it('blocks on address-only input without county/FIPS -- does not call LP or runAgent', async () => {
    const outcome = await runDukePreflight('57 Church Road, Arnold MD', ALLOWLIST, 10_000);
    expect(outcome.type).toBe('blocked');
    expect(mockLp).not.toHaveBeenCalled();
    const b = outcome as Extract<typeof outcome, { type: 'blocked' }>;
    expect(b.message).toContain('Parcel not verified');
    expect(b.message).toContain('no scoring, valuation, or offer');
    expect(b.reason).toBe('missing_parcel_identity');
  });

  it('blocks on address with state but no county -- does not call LP', async () => {
    const outcome = await runDukePreflight('731 Filter Plant Rd, Sparta, NC', ALLOWLIST, 10_000);
    expect(outcome.type).toBe('blocked');
    expect(mockLp).not.toHaveBeenCalled();
    const b = outcome as Extract<typeof outcome, { type: 'blocked' }>;
    expect(b.message).toContain('Provide APN + county');
  });

  it('blocked message tells Tyler to provide county for direct lookup', async () => {
    const outcome = await runDukePreflight('57 Church Road, Arnold MD', ALLOWLIST, 10_000);
    const b = outcome as Extract<typeof outcome, { type: 'blocked' }>;
    expect(b.message).toMatch(/county|APN/i);
  });

  it('blocks with timeout message on LP timeout result', async () => {
    mockLp.mockResolvedValue(TIMEOUT);
    const outcome = await runDukePreflight('APN: 12-345-678, NC', ALLOWLIST, 10_000);
    expect(outcome.type).toBe('blocked');
    const b = outcome as Extract<typeof outcome, { type: 'blocked' }>;
    expect(b.message).toContain('did not respond in time');
    expect(b.message).toContain('no scoring, valuation, or offer');
    expect(b.reason).toBe('lp_timeout');
  });

  it('blocks when lpResolveForPreflight throws', async () => {
    mockLp.mockRejectedValue(new Error('network failure'));
    const outcome = await runDukePreflight('APN: 12-345-678, NC', ALLOWLIST, 10_000);
    expect(outcome.type).toBe('blocked');
    const b = outcome as Extract<typeof outcome, { type: 'blocked' }>;
    expect(b.reason).toBe('preflight_error');
    expect(b.message).toContain('Parcel not verified');
  });

  it('blocks on not_verified without calling runAgent', async () => {
    mockLp.mockResolvedValue(NOT_VERIFIED);
    const outcome = await runDukePreflight('APN: 99-999-999, TX', ALLOWLIST, 10_000);
    expect(outcome.type).toBe('blocked');
    const b = outcome as Extract<typeof outcome, { type: 'blocked' }>;
    expect(b.message).toContain('Parcel not verified');
    expect(b.reason).toBe('not_verified');
  });

  it('blocks on multiple_candidates', async () => {
    mockLp.mockResolvedValue(MULTIPLE);
    const outcome = await runDukePreflight('APN: 12-345-678, NC', ALLOWLIST, 10_000);
    expect(outcome.type).toBe('blocked');
    const b = outcome as Extract<typeof outcome, { type: 'blocked' }>;
    expect(b.message).toContain('Multiple parcels');
    expect(b.reason).toBe('multiple_candidates');
  });

  it('skips on ambiguous_fips so Duke can resolve county via web search', async () => {
    mockLp.mockResolvedValue(AMBIGUOUS_FIPS);
    // This shouldn't normally happen (extractPropertyArgs guards FIPS requirement),
    // but if LP returns ambiguous_fips, pass through rather than block.
    const outcome = await runDukePreflight('APN: 12-345-678, NC', ALLOWLIST, 10_000);
    // ambiguous_fips → skip (let Duke handle)
    expect(outcome.type).toBe('skip');
  });

  it('returns verified outcome for a confirmed parcel', async () => {
    mockLp.mockResolvedValue(VERIFIED);
    const outcome = await runDukePreflight('APN: 12-345-678, NC', ALLOWLIST, 10_000);
    expect(outcome.type).toBe('verified');
    const v = outcome as Extract<typeof outcome, { type: 'verified' }>;
    expect(v.parcelBlock).toContain('verified:true');
    expect(v.parcelBlock).toContain('DO NOT call lp_resolve_property');
    expect(v.parcelBlock).toContain('12-345-678');
    expect(v.parcelBlock).toContain('JOHN SMITH');
  });

  it('excludes landportal from MCP allowlist on verified result', async () => {
    mockLp.mockResolvedValue(VERIFIED);
    const outcome = await runDukePreflight('APN: 12-345-678, NC', ALLOWLIST, 10_000);
    const v = outcome as Extract<typeof outcome, { type: 'verified' }>;
    expect(v.filteredMcpAllowlist).not.toContain('landportal');
    expect(v.filteredMcpAllowlist).toContain('filesystem');
  });

  it('returns safe empty allowlist when incoming allowlist is undefined -- never loads all MCPs', async () => {
    // undefined incoming means "load all MCPs" in the bot; verified preflight must not
    // propagate undefined or LandPortal would still be available after preflight.
    mockLp.mockResolvedValue(VERIFIED);
    const outcome = await runDukePreflight('APN: 12-345-678, NC', undefined, 10_000);
    const v = outcome as Extract<typeof outcome, { type: 'verified' }>;
    expect(v.filteredMcpAllowlist).toBeDefined();
    expect(Array.isArray(v.filteredMcpAllowlist)).toBe(true);
    expect(v.filteredMcpAllowlist).not.toContain('landportal');
  });

  it('includes full property_summary in parcelBlock for Duke to use', async () => {
    mockLp.mockResolvedValue(VERIFIED);
    const outcome = await runDukePreflight('APN: 12-345-678, NC', ALLOWLIST, 10_000);
    const v = outcome as Extract<typeof outcome, { type: 'verified' }>;
    expect(v.parcelBlock).toContain('5.2');   // lot_size_acres
    expect(v.parcelBlock).toContain('62000'); // tlp_estimate
    expect(v.parcelBlock).toContain('87');    // buildability_pct
  });

  it('calls LP with args extracted from message (not comp tools)', async () => {
    mockLp.mockResolvedValue(VERIFIED);
    await runDukePreflight('APN: 12-345-678, NC', ALLOWLIST, 10_000);
    expect(mockLp).toHaveBeenCalledTimes(1);
    const [calledArgs] = mockLp.mock.calls[0];
    // Only APN-related args -- no comp_report or paid-tool fields
    expect(calledArgs).toHaveProperty('apn');
    expect(calledArgs).not.toHaveProperty('comp_report');
    expect(calledArgs).not.toHaveProperty('lp_comp_report_create');
  });

  it('parcelBlock does not contain LP_JWT_TOKEN or Bearer pattern', async () => {
    mockLp.mockResolvedValue(VERIFIED);
    const outcome = await runDukePreflight('APN: 12-345-678, NC', ALLOWLIST, 10_000);
    const v = outcome as Extract<typeof outcome, { type: 'verified' }>;
    expect(v.parcelBlock).not.toMatch(/Bearer\s+\S+/);
    expect(v.parcelBlock).not.toMatch(/LP_JWT_TOKEN/);
  });
});
