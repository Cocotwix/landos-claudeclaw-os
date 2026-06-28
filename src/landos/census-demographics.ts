// LandOS — US Census ACS demographics (supporting market intelligence).
//
// VERIFIED CONTRACT (live-confirmed 2026-06): endpoint
//   https://api.census.gov/data/<year>/acs/acs5
// Inputs: get=<comma vars>, for=county:<CCC>, in=state:<SS>, key=<CENSUS_API_KEY>.
// Geography level: COUNTY (from the parcel's 5-digit FIPS = state(2)+county(3)).
// Response: a 2-row array [headerRow, valueRow] of strings.
// Fields mapped: population (B01003_001E), median household income (B19013_001E),
//   housing units (B25001_001E), owner-occupied (B25003_002E), renter-occupied
//   (B25003_003E). Failure: missing key -> not_configured (free key required —
//   never invented); HTTP!=200 / non-JSON / -666... sentinel -> error/needs.
// Provenance: the query URL (key stripped). Demographics are SUPPORTING market
// context only — NEVER parcel identity.

import { readEnvFile } from '../env.js';

export const CENSUS_KEY_ENV = 'CENSUS_API_KEY';
export const CENSUS_ACS_YEAR = '2023';

export type CensusFetch = (url: string) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

export interface CensusDemographics {
  status: 'verified' | 'not_configured' | 'no_geography' | 'error' | 'not_run';
  county: string | null;
  state: string | null;
  fips: string | null;
  population: number | null;
  medianHouseholdIncome: number | null;
  housingUnits: number | null;
  ownerOccupied: number | null;
  renterOccupied: number | null;
  ownerPct: number | null;
  source: string | null;
  timestamp: string | null;
  note: string;
}

export function emptyCensus(): CensusDemographics {
  return { status: 'not_run', county: null, state: null, fips: null, population: null, medianHouseholdIncome: null, housingUnits: null, ownerOccupied: null, renterOccupied: null, ownerPct: null, source: null, timestamp: null, note: 'Not run (no county FIPS).' };
}

function censusKey(env: Record<string, string | undefined>): string {
  const v = (env[CENSUS_KEY_ENV] ?? '').trim();
  if (v) return v;
  try { return (readEnvFile([CENSUS_KEY_ENV])[CENSUS_KEY_ENV] ?? '').trim(); } catch { return ''; }
}

const VARS = ['B01003_001E', 'B19013_001E', 'B25001_001E', 'B25003_002E', 'B25003_003E'];
const numOrNull = (s: string | undefined): number | null => { if (s == null) return null; const n = Number(s); return Number.isFinite(n) && n > -666666 ? n : null; };

export interface CensusDeps { env?: Record<string, string | undefined>; fetchImpl?: CensusFetch; now?: () => string }

/** Fetch county-level ACS demographics from a 5-digit FIPS. Honest not_configured
 *  when no free CENSUS_API_KEY is set (never invents a key or data). */
export async function fetchCensusDemographics(fips5: string | null | undefined, deps: CensusDeps = {}): Promise<CensusDemographics> {
  const env = deps.env ?? process.env;
  const now = (deps.now ?? (() => new Date().toISOString()))();
  const base = emptyCensus();
  const fips = (fips5 ?? '').trim();
  if (!/^\d{5}$/.test(fips)) return { ...base, status: 'no_geography', note: 'No 5-digit county FIPS available for demographics.' };
  const state = fips.slice(0, 2); const county = fips.slice(2);
  const key = censusKey(env);
  if (!key) return { ...base, status: 'not_configured', state, county, fips, note: 'US Census demographics not configured (no free CENSUS_API_KEY). Add the key to activate; no data invented.' };
  const url = `https://api.census.gov/data/${CENSUS_ACS_YEAR}/acs/acs5?get=NAME,${VARS.join(',')}&for=county:${county}&in=state:${state}`;
  const fetchImpl = deps.fetchImpl ?? (globalThis.fetch as unknown as CensusFetch);
  try {
    const res = await fetchImpl(`${url}&key=${key}`);
    if (!res.ok) return { ...base, status: 'error', state, county, fips, source: url, timestamp: now, note: `Census HTTP ${res.status}.` };
    const txt = await res.text();
    let rows: string[][]; try { rows = JSON.parse(txt) as string[][]; } catch { return { ...base, status: 'error', state, county, fips, source: url, timestamp: now, note: 'Census returned non-JSON (key/quota issue).' }; }
    const header = rows[0]; const vals = rows[1];
    if (!header || !vals) return { ...base, status: 'error', state, county, fips, source: url, timestamp: now, note: 'Census returned no data row.' };
    const get = (v: string) => numOrNull(vals[header.indexOf(v)]);
    const owner = get('B25003_002E'); const renter = get('B25003_003E');
    const ownerPct = owner != null && renter != null && owner + renter > 0 ? Math.round((owner / (owner + renter)) * 100) : null;
    return {
      status: 'verified',
      county: vals[header.indexOf('NAME')] ?? null,
      state, fips,
      population: get('B01003_001E'),
      medianHouseholdIncome: get('B19013_001E'),
      housingUnits: get('B25001_001E'),
      ownerOccupied: owner, renterOccupied: renter, ownerPct,
      source: url, timestamp: now,
      note: 'US Census ACS 5-year, county level (official supporting market context).',
    };
  } catch (e: unknown) {
    return { ...base, status: 'error', state, county, fips, source: url, timestamp: now, note: `Census error: ${(e as Error)?.message ?? String(e)}.` };
  }
}
