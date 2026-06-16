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

  it('captures the base64 ?property= LP URL for forwarding (Chinquapin)', () => {
    const url =
      'https://landportal.com/?property=Zmlwcz0zNzA2MSZhcG49MDgtMjUxOC0rKy0rKy0mbGxfdXVpZD05NjUzMTE1NQ%3D%3D';
    const r = extractPropertyArgs(`3832 S NC 50 Hwy, Chinquapin, NC ${url}`);
    expect(r).toMatchObject({ lp_url: url });
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

  it('parses a full street address + city + state without FIPS (comma form)', () => {
    // No FIPS supplied: still parse the address so the resolver returns
    // ambiguous_fips and Duke resolves county via its non-coordinate ladder.
    const r = extractPropertyArgs('731 Filter Plant Rd, Sparta, NC');
    expect(r).toMatchObject({ address: '731 Filter Plant Rd', city: 'Sparta', state: 'NC' });
    expect(r?.fips).toBeUndefined();
  });

  it('parses the Clydeville fixture (street, city, state, ZIP) as an address input', () => {
    const r = extractPropertyArgs('217 Clydeville Ln, Cottageville, SC 29435');
    expect(r).toMatchObject({ address: '217 Clydeville Ln', city: 'Cottageville', state: 'SC' });
    expect(r?.fips).toBeUndefined();
  });

  it('parses an address with city + state and no comma before the state', () => {
    const r = extractPropertyArgs('57 Church Road, Arnold MD');
    expect(r).toMatchObject({ address: '57 Church Road', city: 'Arnold', state: 'MD' });
  });

  it('still includes a labeled FIPS with a full address when present', () => {
    const r = extractPropertyArgs('731 Filter Plant Rd, Sparta, NC fips: 37005');
    expect(r).toMatchObject({ address: '731 Filter Plant Rd', city: 'Sparta', state: 'NC', fips: '37005' });
  });

  it('returns null for a street address with no city or state', () => {
    expect(extractPropertyArgs('57 Church Road')).toBeNull();
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

  it('blocks property-ish input with no parseable address/state -- does not call LP', async () => {
    const outcome = await runDukePreflight('Run due diligence on this parcel', ALLOWLIST, 10_000);
    expect(outcome.type).toBe('blocked');
    expect(mockLp).not.toHaveBeenCalled();
    const b = outcome as Extract<typeof outcome, { type: 'blocked' }>;
    expect(b.message).toContain('Parcel not verified');
    expect(b.message).toContain('no scoring, valuation, or offer');
    expect(b.reason).toBe('missing_parcel_identity');
  });

  it('does not re-ask for an address when a full address was supplied', async () => {
    const outcome = await runDukePreflight('57 Church Road', ALLOWLIST, 10_000);
    const b = outcome as Extract<typeof outcome, { type: 'blocked' }>;
    // Improved message never tells Tyler to "provide address".
    expect(b.message).not.toMatch(/provide.*address|address \+ county/i);
    // But still points to a valid non-coordinate identifier path.
    expect(b.message).toMatch(/county|APN|FIPS/i);
  });

  it('does NOT instantly block a full address with city/state/ZIP -- routes to lookup (Clydeville)', async () => {
    // Live bug: "217 Clydeville Ln, Cottageville, SC 29435" returned an instant
    // "provide address + county/state". It must reach the resolver instead.
    mockLp.mockResolvedValue(AMBIGUOUS_FIPS);
    const outcome = await runDukePreflight('217 Clydeville Ln, Cottageville, SC 29435', ALLOWLIST, 10_000);
    expect(mockLp).toHaveBeenCalledTimes(1);
    expect(mockLp).toHaveBeenCalledWith(
      expect.objectContaining({ address: '217 Clydeville Ln', city: 'Cottageville', state: 'SC' }),
      10_000,
    );
    // ambiguous_fips passes through so Duke can resolve county via its allowed,
    // non-coordinate recovery ladder (county assessor/GIS) -- not a hard block.
    expect(outcome.type).toBe('skip');
  });

  it('skips a full address with state but no county so Duke can resolve county', async () => {
    mockLp.mockResolvedValue(AMBIGUOUS_FIPS);
    const outcome = await runDukePreflight('731 Filter Plant Rd, Sparta, NC', ALLOWLIST, 10_000);
    expect(outcome.type).toBe('skip');
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
