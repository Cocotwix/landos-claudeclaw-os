// LandOS — structured county assessor-search adapters.
//
// Some counties are ABSENT from every statewide public parcel GIS layer
// (Tennessee's Comptroller public-use layer excludes the self-hosting
// counties, Williamson among them), while the county assessor itself publishes
// a keyless structured property search. For those jurisdictions the official
// parcel GIS lookup can never match — not because the parcel is missing, but
// because the layer does not carry the county at all. This module is the
// bounded repair for that seam: a per-county registry of official
// assessor-search adapters that resolve the canonical APN directly against the
// county's own current assessment database and return official facts with
// provenance.
//
// Identity rules are the same hard gate as everywhere else in LandOS:
//   - The APN's canonical decomposition must match the official parcel
//     identifier segment for segment. No fuzzy matching, no partial parcel
//     collisions, no owner-name-only resolution, no nearest-parcel fallback.
//   - Multiple candidates never substitute; zero verified candidates is an
//     honest no_match.
//   - Missing stays missing: a field the record does not publish is absent,
//     never inferred.

import { tennesseeCanonicalApnParts } from './public-property-intelligence-live.js';

export interface CountyAssessorRecordFact {
  field: string;
  value: string;
  classification: 'official_record' | 'recorded_instrument';
  source: string | null;
  sourceUrl: string | null;
  retrievedAt: string | null;
}

export interface CountyAssessorLookupOutcome {
  status: 'matched' | 'no_match' | 'unavailable';
  source: string;
  sourceUrl: string | null;
  note: string;
  jurisdiction: string | null;
  summary: string | null;
  records: CountyAssessorRecordFact[];
  /** The official parcel identifier as the source itself prints it. */
  officialParcelId: string | null;
}

type FetchLike = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null; getSetCookie?: () => string[] };
  text(): Promise<string>;
}>;

interface CountyAssessorAdapter {
  source: string;
  match(county: string | undefined, state: string | undefined): boolean;
  run(
    input: { county?: string; state?: string; apn?: string },
    timeoutMs: number,
    fetchImpl: FetchLike,
    signal?: AbortSignal,
  ): Promise<CountyAssessorLookupOutcome>;
}

const WILLIAMSON_BASE = 'https://inigo.williamson-tn.org/property_search';
export const WILLIAMSON_ASSESSOR_SOURCE = 'Williamson County Property Assessment Database (inigo.williamson-tn.org)';

const trimmed = (value: unknown): string | null => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text || null;
};

/**
 * PURE: does an official Williamson parcel identifier ("042    12300 000",
 * "042G C 00200 000") name exactly the canonical TN APN? Segment-for-segment:
 * control map (with any letter), optional group letter, five parcel digits,
 * and the SI suffix when the canonical APN carries one. Never a substring or
 * digit-soup comparison — "042 12312 000" must NOT match parcel 123.00.
 */
export function williamsonParcelIdMatchesApn(officialParcelId: string, apn: string): boolean {
  const parts = tennesseeCanonicalApnParts(apn);
  if (!parts) return false;
  const tokens = String(officialParcelId ?? '').trim().toUpperCase().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return false;
  const [mapToken, maybeGroup, ...rest] = tokens;
  const hasGroup = /^[A-Z]$/.test(maybeGroup ?? '');
  const parcelToken = hasGroup ? rest[0] : maybeGroup;
  const siToken = hasGroup ? rest[1] : rest[0];
  if (mapToken !== parts.controlMap) return false;
  if (parts.group && (!hasGroup || maybeGroup !== parts.group)) return false;
  if (!parts.group && hasGroup) return false;
  if ((parcelToken ?? '').padStart(5, '0') !== parts.parcelDigits.padStart(5, '0')) return false;
  if (parts.specialInterest != null && siToken != null && siToken !== parts.specialInterest) return false;
  return true;
}

/** PURE: label/value extraction from the Williamson parcel-detail page. */
export function parseWilliamsonParcelDetail(html: string): {
  fields: Record<string, string>;
  buildings: string | null;
  sales: Array<{ date: string; price: string; deedBook: string; deedPage: string }>;
} {
  const fields: Record<string, string> = {};
  for (const block of html.matchAll(/<dl[^>]*>\s*<dt>([^<]+)<\/dt>\s*<dd>([\s\S]*?)<\/dd>/gi)) {
    const label = trimmed(block[1]);
    const value = trimmed(block[2].replace(/<br\s*\/?>/gi, ', ').replace(/<[^>]+>/g, ' '));
    if (label && value) fields[label] = value;
  }
  for (const row of html.matchAll(/<tr>\s*<th>([\s\S]*?)<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/gi)) {
    const label = trimmed(row[1]);
    const value = trimmed(row[2]);
    if (label && value) fields[label] = value;
  }
  const buildingSection = /<section id="[^"]*building_information">([\s\S]*?)<\/section>/i.exec(html)?.[1] ?? '';
  const buildings = trimmed(buildingSection.replace(/<h2>[\s\S]*?<\/h2>/i, '').replace(/<[^>]+>/g, ' '));
  const sales: Array<{ date: string; price: string; deedBook: string; deedPage: string }> = [];
  const salesSection = /<section id="sales_information">([\s\S]*?)<\/section>/i.exec(html)?.[1] ?? '';
  for (const row of salesSection.matchAll(/<tr>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<\/tr>/gi)) {
    const [date, price, deedBook, deedPage] = [row[1], row[2], row[3], row[4]].map((cell) => trimmed(cell) ?? '');
    if (date) sales.push({ date, price, deedBook, deedPage });
  }
  return { fields, buildings: buildings || null, sales };
}

async function fetchWithTimeout(
  fetchImpl: FetchLike,
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ body: string; setCookies: string[] }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await fetchImpl(url, { headers, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status} from ${url.split('?')[0]}`);
    const setCookies = response.headers.getSetCookie?.() ?? (response.headers.get('set-cookie') ? [response.headers.get('set-cookie')!] : []);
    return { body: await response.text(), setCookies };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

const WILLIAMSON_ADAPTER: CountyAssessorAdapter = {
  source: WILLIAMSON_ASSESSOR_SOURCE,
  match: (county, state) =>
    /^(?:TN|TENNESSEE)$/i.test(String(state ?? '').trim())
    && /^williamson(?:\s+county)?$/i.test(String(county ?? '').trim()),
  async run(input, timeoutMs, fetchImpl, signal) {
    const base = (status: CountyAssessorLookupOutcome['status'], note: string): CountyAssessorLookupOutcome => ({
      status,
      source: WILLIAMSON_ASSESSOR_SOURCE,
      sourceUrl: `${WILLIAMSON_BASE}/`,
      note,
      jurisdiction: 'Williamson County, TN',
      summary: null,
      records: [],
      officialParcelId: null,
    });
    const parts = input.apn ? tennesseeCanonicalApnParts(input.apn) : null;
    if (!parts) {
      return base('unavailable', 'The canonical APN does not carry a Tennessee map–parcel decomposition, so the county assessor search cannot be keyed safely.');
    }

    // Session + CSRF token from the search landing page.
    const landing = await fetchWithTimeout(fetchImpl, `${WILLIAMSON_BASE}/`, {}, timeoutMs, signal);
    const csrf = /name="csrf_token"[^>]*value="([^"]+)"/.exec(landing.body)?.[1];
    if (!csrf) return base('unavailable', 'The county assessor search did not present its expected search form.');
    const cookie = landing.setCookies.map((entry) => entry.split(';')[0]).join('; ');
    const headers: Record<string, string> = cookie ? { cookie } : {};

    // Structured search keyed strictly by the canonical map + parcel digits.
    const searchUrl = `${WILLIAMSON_BASE}/json/search?csrf_token=${encodeURIComponent(csrf)}&owner_name=&property_address=&subdivision=&city=&lot=&map_number=${encodeURIComponent(parts.controlMap)}&parcel=${encodeURIComponent(parts.parcelDigits)}&sales_date_start=&sales_date_end=`;
    const search = await fetchWithTimeout(fetchImpl, searchUrl, headers, timeoutMs, signal);
    let hits: Array<Record<string, unknown>> = [];
    try {
      const parsed = JSON.parse(search.body) as { data?: Array<Record<string, unknown>> };
      hits = Array.isArray(parsed.data) ? parsed.data : [];
    } catch {
      return base('unavailable', 'The county assessor search returned an unreadable response.');
    }

    const verified = hits.filter((hit) => williamsonParcelIdMatchesApn(String(hit['Parcel ID'] ?? ''), input.apn!));
    if (verified.length === 0) {
      return base('no_match', `The county assessment database returned ${hits.length} candidate(s) for map ${parts.controlMap} parcel ${parts.parcelPrinted}, and none matched the canonical parcel identifier segment for segment. No candidate was substituted.`);
    }
    if (verified.length > 1) {
      return base('no_match', `${verified.length} official records matched the canonical parcel identifier — ambiguous, none substituted.`);
    }

    const hit = verified[0];
    const lrsn = String(hit.lrsn ?? hit.DT_RowId ?? '').trim();
    const officialParcelId = trimmed(hit['Parcel ID']);
    if (!/^\d+$/.test(lrsn)) {
      return base('unavailable', 'The matched official record did not carry a readable detail-record key.');
    }

    const detailUrl = `${WILLIAMSON_BASE}/parcel/${lrsn}?csrf=${encodeURIComponent(csrf)}`;
    const detail = await fetchWithTimeout(fetchImpl, detailUrl, headers, timeoutMs, signal);
    const { fields, buildings, sales } = parseWilliamsonParcelDetail(detail.body);

    const retrievedAt = new Date().toISOString();
    const records: CountyAssessorRecordFact[] = [];
    const push = (field: string, value: string | null | undefined, classification: CountyAssessorRecordFact['classification'] = 'official_record') => {
      const text = trimmed(value);
      if (text) records.push({ field, value: text, classification, source: WILLIAMSON_ASSESSOR_SOURCE, sourceUrl: `${WILLIAMSON_BASE}/`, retrievedAt });
    };

    push('APN', officialParcelId);
    // "Address" appears twice on the page (owner mailing, then property
    // location); the dl scan keeps the LAST one, which is the situs. The owner
    // mailing address dd carries the comma-joined two-line form.
    const ownerAddressBlock = /<dl id="owner_address">[\s\S]*?<dd>([\s\S]*?)<\/dd>/i.exec(detail.body)?.[1];
    const situsBlock = /<dl id="prop_street">[\s\S]*?<dd>([\s\S]*?)<\/dd>/i.exec(detail.body)?.[1];
    push('Owner of record', fields.Owner);
    push('Owner mailing address', ownerAddressBlock ? trimmed(ownerAddressBlock.replace(/<br\s*\/?>/gi, ', ').replace(/<[^>]+>/g, ' ')) : null);
    push('Situs address', situsBlock ? trimmed(situsBlock.replace(/<[^>]+>/g, ' ')) : null);
    push('Assessed acreage', fields['Legal Acreage']);
    push('Land use class', fields['Property Class']);
    push('Tax district / area', fields.City);
    push('Appraised value (land)', fields['Land Market Value']);
    push('Improvement appraised value', fields['Improvement Value']);
    push('Total appraised value', fields['Total Market Appraisal']);
    push('Taxable value', fields.Assessment);
    push('Assessment ratio', fields['Assessment %']);
    push('Property-tax year', fields['Current Tax Year']);
    push('Valuation year', fields['Valuation Year']);
    push('Improvements (assessor)', buildings);
    if (sales[0]) {
      push('Last recorded sale date', sales[0].date, 'recorded_instrument');
      push('Last recorded sale price', sales[0].price, 'recorded_instrument');
      if (sales[0].deedBook || sales[0].deedPage) {
        push('Deed book/page', `${sales[0].deedBook}/${sales[0].deedPage}`.replace(/^\/|\/$/g, ''), 'recorded_instrument');
      }
    }

    const situs = trimmed(situsBlock?.replace(/<[^>]+>/g, ' '));
    return {
      status: 'matched',
      source: WILLIAMSON_ASSESSOR_SOURCE,
      sourceUrl: `${WILLIAMSON_BASE}/`,
      note: `The canonical APN matched exactly one official assessment record (parcel ID "${officialParcelId}").`,
      jurisdiction: 'Williamson County, TN',
      summary: `Official Williamson County assessment record retrieved for parcel ${officialParcelId}: owner, situs, acreage, values${buildings ? `, improvements (${buildings.toLowerCase()})` : ''} and recorded sales.${situs ? ` Situs of record: ${situs}.` : ''}`,
      records,
      officialParcelId,
    };
  },
};

const COUNTY_ASSESSOR_ADAPTERS: CountyAssessorAdapter[] = [WILLIAMSON_ADAPTER];

export function countyAssessorSearchSourceFor(
  input: { county?: string | null; state?: string | null },
): string | null {
  return COUNTY_ASSESSOR_ADAPTERS.find((adapter) => adapter.match(input.county ?? undefined, input.state ?? undefined))?.source ?? null;
}

/**
 * The one entry point: run the county's official assessor-search adapter for
 * this jurisdiction, or return null when no adapter covers it. Never throws
 * for provider-local failures — they come back as an honest `unavailable`.
 */
export async function lookupCountyAssessorRecord(
  input: { county?: string | null; state?: string | null; apn?: string | null },
  timeoutMs: number,
  signal?: AbortSignal,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<CountyAssessorLookupOutcome | null> {
  const adapter = COUNTY_ASSESSOR_ADAPTERS.find((entry) => entry.match(input.county ?? undefined, input.state ?? undefined));
  if (!adapter) return null;
  try {
    return await adapter.run(
      { county: input.county ?? undefined, state: input.state ?? undefined, apn: input.apn ?? undefined },
      timeoutMs,
      fetchImpl,
      signal,
    );
  } catch (error) {
    return {
      status: 'unavailable',
      source: adapter.source,
      sourceUrl: null,
      note: `The county assessor search could not answer: ${error instanceof Error ? error.message : String(error)}`,
      jurisdiction: null,
      summary: null,
      records: [],
      officialParcelId: null,
    };
  }
}
