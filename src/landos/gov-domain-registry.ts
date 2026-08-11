// LandOS — verified discovery of a government's real official web presence.
//
// The hostname formula in `land-use-local.ts` is fast and free and it covers a
// large share of the country, but it can only ever find a government that
// spells its own name out. The live acceptance subject proved the gap:
// Grand Traverse County, Michigan publishes at `gtcountymi.gov`, an
// ABBREVIATED name that no formula over "grand traverse" will ever produce. The
// formula missed, the lane fell straight through, and the mandatory county
// subdivision fallback activated with nothing to read.
//
// The gap is closed with the authoritative registry of the .gov namespace
// itself. CISA is the .gov registrar and publishes the full current zone as a
// machine-readable table: domain, domain type (Federal / State / County / City
// / Township / Tribal / ...), registrant organization, city and state. A row in
// it IS the verification of government ownership — the registrant organization
// named the jurisdiction when it registered the domain.
//
// This is discovery, not a directory build. Nothing here names a jurisdiction,
// no county is enumerated ahead of time, and the registry is read once per
// process and only when a lookup actually misses.

import { defaultGovFetchText, type GovFetchText } from './gis-transport.js';
import type { GovernmentUnitType } from './land-use-types.js';

/**
 * CISA's published .gov zone data. `get.gov/about/data/` is the human page for
 * this same file; this is its machine-readable form.
 */
export const DOTGOV_REGISTRY_URL = 'https://raw.githubusercontent.com/cisagov/dotgov-data/main/current-full.csv';

export interface GovDomainRow {
  domain: string;
  /** Registry's own classification: Federal, State, County, City, Township… */
  domainType: string;
  organization: string;
  city: string;
  state: string;
}

/** Registry organization names carry the unit word; the jurisdiction may not. */
function placeToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/\bcharter\b/g, ' ')
    .replace(/\b(county|parish|borough|city|town|township|village|municipality|of|the)\b/g, ' ')
    .replace(/[^a-z0-9]/g, '');
}

/** Split one CSV record, honouring quoted fields. */
function csvFields(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"') {
        if (line[i + 1] === '"') { current += '"'; i += 1; } else { quoted = false; }
      } else current += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { fields.push(current); current = ''; }
    else current += char;
  }
  fields.push(current);
  return fields.map((field) => field.trim());
}

/**
 * Parse the registry table.
 *
 * Columns are read BY HEADER NAME, never by position: the registrar has added
 * columns to this file before (a suborganization column arrived after the
 * original five), and a positional reader would silently start reporting the
 * wrong field as the state.
 */
export function parseGovDomainRegistry(csv: string): GovDomainRow[] {
  const lines = csv.split(/\r?\n/).filter((line) => line.trim().length);
  if (lines.length < 2) return [];
  const header = csvFields(lines[0]).map((name) => name.toLowerCase());
  const at = (...names: string[]): number => {
    for (const name of names) {
      const index = header.findIndex((column) => column === name);
      if (index >= 0) return index;
    }
    return -1;
  };
  const domainAt = at('domain name', 'domain');
  const typeAt = at('domain type');
  const orgAt = at('organization name', 'agency');
  const cityAt = at('city');
  const stateAt = at('state');
  if (domainAt < 0 || orgAt < 0 || stateAt < 0) return [];

  const rows: GovDomainRow[] = [];
  for (const line of lines.slice(1)) {
    const fields = csvFields(line);
    const domain = (fields[domainAt] ?? '').toLowerCase();
    if (!domain || !domain.includes('.')) continue;
    rows.push({
      domain,
      domainType: typeAt >= 0 ? (fields[typeAt] ?? '') : '',
      organization: fields[orgAt] ?? '',
      city: cityAt >= 0 ? (fields[cityAt] ?? '') : '',
      state: (fields[stateAt] ?? '').toUpperCase(),
    });
  }
  return rows;
}

/** Which registry domain types can plausibly be this kind of government. */
function typeMatches(domainType: string, unitType: GovernmentUnitType): boolean {
  const type = domainType.trim().toLowerCase();
  // The registry classifies a domain by the registrant's level of government.
  // A county's domain is filed as County; a township's is frequently filed as
  // City or Township depending on the registrar's own reading, so a sub-county
  // government accepts either. Federal, State and Tribal are never a local
  // planning authority for a parcel and are rejected outright.
  if (type === 'federal' || type === 'state' || type === 'tribal' || type === 'interstate') return false;
  const isCounty = unitType === 'county' || unitType === 'unincorporated_county' || unitType === 'parish';
  if (isCounty) return type === 'county' || type === '';
  return type !== 'county';
}

/**
 * Registry rows that belong to this jurisdiction, best first.
 *
 * The match is on the REGISTRANT ORGANIZATION and the state, never on how the
 * hostname happens to read. `gtcountymi.gov` is registered to "Grand Traverse
 * County" in MI, and that is what makes it this county's official domain.
 */
export function governmentDomainsFor(
  rows: readonly GovDomainRow[],
  jurisdiction: string,
  state: string,
  unitType: GovernmentUnitType,
): GovDomainRow[] {
  const wanted = placeToken(jurisdiction);
  const st = state.trim().toUpperCase();
  if (!wanted || !st) return [];
  const exact: GovDomainRow[] = [];
  const partial: GovDomainRow[] = [];
  for (const row of rows) {
    if (row.state !== st) continue;
    if (!typeMatches(row.domainType, unitType)) continue;
    const org = placeToken(row.organization);
    if (!org) continue;
    if (org === wanted) exact.push(row);
    // A containment match is accepted only in the direction that cannot
    // broaden: "Grand Traverse County Road Commission" contains the county, so
    // it stays a candidate; "Traverse City" does not contain the county name
    // and is never promoted into it.
    else if (org.includes(wanted)) partial.push(row);
  }
  return [...exact, ...partial];
}

/** Registry text, fetched once per process — it is a 1.4 MB national table. */
let cachedCsv: string | null = null;
let cachedAt = 0;
const REGISTRY_TTL_MS = 6 * 60 * 60 * 1000;

/** Reset the in-process registry cache. Tests only. */
export function resetGovDomainRegistryCache(): void {
  cachedCsv = null;
  cachedAt = 0;
}

export async function loadGovDomainRegistry(deps: { fetchText?: GovFetchText } = {}): Promise<GovDomainRow[]> {
  const fetchText = deps.fetchText ?? defaultGovFetchText;
  if (cachedCsv && Date.now() - cachedAt < REGISTRY_TTL_MS) return parseGovDomainRegistry(cachedCsv);
  try {
    const response = await fetchText(DOTGOV_REGISTRY_URL, { timeoutMs: 25_000 });
    if (response.blocked || response.status >= 400) return [];
    // A body that does not parse into registry rows is an error page, not an
    // empty registry — do not cache it as one.
    const rows = parseGovDomainRegistry(response.body);
    if (!rows.length) return [];
    cachedCsv = response.body;
    cachedAt = Date.now();
    return rows;
  } catch {
    return [];
  }
}

export interface DiscoveredGovDomain {
  /** Host to try, `www.` first because most government CMSes canonicalize to it. */
  host: string;
  row: GovDomainRow;
}

/**
 * Hosts to attempt for a jurisdiction, derived from the registry.
 *
 * Bounded on purpose: the first few organization matches, each as `www.` and
 * bare. A registry row is a strong signal, not a licence to walk the zone.
 */
export async function discoverGovernmentHosts(
  jurisdiction: string,
  state: string,
  unitType: GovernmentUnitType,
  deps: { fetchText?: GovFetchText; maxDomains?: number } = {},
): Promise<DiscoveredGovDomain[]> {
  const rows = await loadGovDomainRegistry(deps);
  if (!rows.length) return [];
  const matches = governmentDomainsFor(rows, jurisdiction, state, unitType).slice(0, deps.maxDomains ?? 3);
  const hosts: DiscoveredGovDomain[] = [];
  for (const row of matches) {
    hosts.push({ host: `www.${row.domain}`, row });
    hosts.push({ host: row.domain, row });
  }
  return hosts;
}

/** How a registry-verified site is described to an operator. */
export function registryBasis(row: GovDomainRow): string {
  return `${row.domain} is registered in the official .gov registry to ${row.organization}`
    + `${row.city ? `, ${row.city}` : ''}, ${row.state}`
    + `${row.domainType ? ` (registry domain type: ${row.domainType})` : ''}.`;
}
