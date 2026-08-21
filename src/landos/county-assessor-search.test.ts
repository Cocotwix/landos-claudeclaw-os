import { describe, expect, it } from 'vitest';

import {
  lookupCountyAssessorRecord,
  parseWilliamsonParcelDetail,
  williamsonParcelIdMatchesApn,
  WILLIAMSON_ASSESSOR_SOURCE,
} from './county-assessor-search.js';

// Synthetic detail page mirroring the county app's markup — not a real record.
const DETAIL_HTML = `
<div id="500001"><article id="property_details">
 <dl id="county_number"><dt>County Number</dt><dd>94</dd></dl>
 <dl id="tax_year"><dt>Current Tax Year</dt><dd> 2026</dd></dl>
 <dl id="owner1"><dt>Owner</dt><dd>EXAMPLE HOLDINGS LLC</dd></dl>
 <dl id="owner_address"><dt>Address</dt><dd>
 100 SAMPLE PIKE<br />
 FRANKLIN, TN   37069
 </dd></dl>
 <dl id="prop_street"><dt>Address</dt><dd>EXAMPLE RD</dd></dl>
 <dl id="cntrl_map"><dt>Ctrl</dt><dd>031 </dd></dl>
 <dl id="parcel"><dt>Parcel</dt><dd>04500</dd></dl>
 <dl id="si"><dt>SI</dt><dd>000</dd></dl>
 <dl id="valuation_year"><dt>Valuation Year</dt><dd>2026</dd></dl>
 <table><caption>Market Appraisal</caption><tbody>
  <tr><th>Land Market Value</th><td class="text-right">$400,000</td></tr>
  <tr><th>Improvement Value</th><td class="text-right">$0</td></tr>
  <tr><th>Total Market Appraisal</th><td class="text-right">$400,000</td></tr>
 </tbody></table>
 <dl id="percentage_string"><dt>Assessment %</dt><dd>25%</dd></dl>
 <dl id="assessment_amount"><dt>Assessment</dt><dd>$100,000</dd></dl>
 <dl id="legal_acreage"><dt>Legal Acreage</dt><dd>20.5000</dd></dl>
 <dl id="property_class"><dt>Property Class</dt><dd>110 Farm</dd></dl>
 <dl id="district_city"><dt>City</dt><dd>Fairview (255   )</dd></dl>
 <section id="plat_bpsbuilding_information"><h2>Building Information</h2>
  <p class="callout secondary">No buildings on record</p></section>
 <section id="sales_information"><h2>Sales Information</h2><table><thead>
  <tr><th>Sales Date</th><th>Price</th><th>Deed Book</th><th>Deed Page</th></tr></thead><tbody>
  <tr><td>2024-01-15</td><td>$0</td><td>9000    </td><td>111     </td></tr>
  <tr><td>2010-06-01</td><td>$250,000</td><td>5000    </td><td>222     </td></tr>
 </tbody></table></section>
</article></div>`;

describe('Williamson parcel-identifier identity matching (pure)', () => {
  it('matches the canonical map–parcel–SI APN segment for segment', () => {
    expect(williamsonParcelIdMatchesApn('031    04500 000', '031-045.00-000')).toBe(true);
    expect(williamsonParcelIdMatchesApn('042    12300 000', '042-123.00-000')).toBe(true);
  });

  it('never cross-matches a different parcel sharing a digit prefix', () => {
    // parcel 123.12 must not pass as 123.00 — the exact false match that
    // digit-soup containment would have allowed.
    expect(williamsonParcelIdMatchesApn('042    12312 000', '042-123.00-000')).toBe(false);
    expect(williamsonParcelIdMatchesApn('043    12300 000', '042-123.00-000')).toBe(false);
    expect(williamsonParcelIdMatchesApn('042    12300 001', '042-123.00-000')).toBe(false);
  });

  it('respects the group letter and refuses a group mismatch', () => {
    expect(williamsonParcelIdMatchesApn('042G C 00200 000', '042-123.00-000')).toBe(false);
  });

  it('refuses an APN with no Tennessee canonical decomposition', () => {
    expect(williamsonParcelIdMatchesApn('031    04500 000', 'not an apn')).toBe(false);
  });
});

describe('Williamson parcel-detail parsing (pure)', () => {
  it('extracts official fields, building status and recorded sales', () => {
    const parsed = parseWilliamsonParcelDetail(DETAIL_HTML);
    expect(parsed.fields.Owner).toBe('EXAMPLE HOLDINGS LLC');
    expect(parsed.fields['Legal Acreage']).toBe('20.5000');
    expect(parsed.fields['Property Class']).toBe('110 Farm');
    expect(parsed.fields['Land Market Value']).toBe('$400,000');
    expect(parsed.fields['Improvement Value']).toBe('$0');
    expect(parsed.buildings).toBe('No buildings on record');
    expect(parsed.sales[0]).toEqual({ date: '2024-01-15', price: '$0', deedBook: '9000', deedPage: '111' });
  });
});

function stubFetch(routes: Record<string, { body: string; cookies?: string[] }>) {
  const calls: string[] = [];
  const impl = async (url: string) => {
    calls.push(url);
    const key = Object.keys(routes).find((prefix) => url.startsWith(prefix));
    if (!key) throw new Error(`unexpected fetch ${url}`);
    const route = routes[key];
    return {
      ok: true,
      status: 200,
      headers: { get: () => null, getSetCookie: () => route.cookies ?? [] },
      text: async () => route.body,
    };
  };
  return { impl, calls };
}

const BASE = 'https://inigo.williamson-tn.org/property_search';
const LANDING = { body: '<form><input name="csrf_token" type="hidden" value="tok123"></form>', cookies: ['session=abc; Path=/'] };

describe('lookupCountyAssessorRecord', () => {
  it('returns null for a jurisdiction no county adapter covers', async () => {
    const outcome = await lookupCountyAssessorRecord({ county: 'Davidson', state: 'TN', apn: '031-045.00-000' }, 5_000, undefined, async () => { throw new Error('must not fetch'); });
    expect(outcome).toBeNull();
  });

  it('resolves the canonical APN against the county assessment database and retains official facts with provenance', async () => {
    const { impl } = stubFetch({
      [`${BASE}/json/search`]: { body: JSON.stringify({ data: [{ DT_RowId: 500001, lrsn: 500001, 'Parcel ID': '031    04500 000', Owner: 'EXAMPLE HOLDINGS LLC', 'Property Address': 'EXAMPLE RD' }] }) },
      [`${BASE}/parcel/500001`]: { body: DETAIL_HTML },
      [`${BASE}/`]: LANDING,
    });
    const outcome = await lookupCountyAssessorRecord({ county: 'Williamson', state: 'TN', apn: '031-045.00-000' }, 5_000, undefined, impl);
    expect(outcome?.status).toBe('matched');
    expect(outcome?.officialParcelId).toBe('031 04500 000');
    const byField = new Map(outcome!.records.map((record) => [record.field, record.value]));
    expect(byField.get('Owner of record')).toBe('EXAMPLE HOLDINGS LLC');
    expect(byField.get('Situs address')).toBe('EXAMPLE RD');
    expect(byField.get('Assessed acreage')).toBe('20.5000');
    expect(byField.get('Improvements (assessor)')).toBe('No buildings on record');
    expect(byField.get('Last recorded sale date')).toBe('2024-01-15');
    expect(outcome!.records.every((record) => record.source === WILLIAMSON_ASSESSOR_SOURCE)).toBe(true);
  });

  it('refuses to substitute when no candidate matches the canonical parcel identifier', async () => {
    const { impl, calls } = stubFetch({
      [`${BASE}/json/search`]: { body: JSON.stringify({ data: [
        { DT_RowId: 1, lrsn: 1, 'Parcel ID': '031    04512 000', Owner: 'A' },
        { DT_RowId: 2, lrsn: 2, 'Parcel ID': '031    04502 000', Owner: 'B' },
      ] }) },
      [`${BASE}/`]: LANDING,
    });
    const outcome = await lookupCountyAssessorRecord({ county: 'Williamson', state: 'TN', apn: '031-045.00-000' }, 5_000, undefined, impl);
    expect(outcome?.status).toBe('no_match');
    expect(outcome?.records).toEqual([]);
    // The detail page is never fetched for an unverified candidate.
    expect(calls.some((url) => url.includes('/parcel/'))).toBe(false);
  });

  it('never resolves by owner name and never keys the search on anything but the canonical APN decomposition', async () => {
    const { impl, calls } = stubFetch({
      [`${BASE}/json/search`]: { body: JSON.stringify({ data: [] }) },
      [`${BASE}/`]: LANDING,
    });
    const outcome = await lookupCountyAssessorRecord({ county: 'Williamson', state: 'TN', apn: '031-045.00-000' }, 5_000, undefined, impl);
    expect(outcome?.status).toBe('no_match');
    const search = calls.find((url) => url.includes('/json/search'))!;
    expect(search).toContain('map_number=031');
    expect(search).toContain('parcel=04500');
    expect(search).toContain('owner_name=&');
  });

  it('reports unavailable, not a fabricated answer, when the source cannot be reached', async () => {
    const outcome = await lookupCountyAssessorRecord({ county: 'Williamson', state: 'TN', apn: '031-045.00-000' }, 5_000, undefined, async () => { throw new Error('ENOTFOUND'); });
    expect(outcome?.status).toBe('unavailable');
    expect(outcome?.records).toEqual([]);
  });
});
