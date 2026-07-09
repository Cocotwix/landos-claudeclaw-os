// Official outside-source research layer for Duke due diligence.
//
// After parcel verification (the identity gate), Duke continues into outside
// research. This module produces an official-source research card: real,
// on-demand, public/official source links where we are confident, and an
// explicit data_gap with the exact source needed where we are not. It NEVER
// fabricates facts, NEVER uses coordinates/geocoders, NEVER scrapes, and makes
// no network call itself (pure: it emits source links the operator opens).

export type OfficialSourceStatus =
  | 'available'
  | 'source_available'
  | 'data_gap'
  | 'not_connected'
  | 'blocked_needs_approval'
  | 'blocked_by_guardrail';

export interface OfficialSource {
  id: string;
  label: string;
  group: 'national_research' | 'county_records';
  status: OfficialSourceStatus;
  sourceName?: string;
  sourceUrl?: string;
  note: string;
  /** Exact source/approval needed when status is data_gap / blocked. */
  approvalNeeded?: string;
}

export interface OfficialSourcesCard {
  area: { city?: string; county?: string; state?: string; descriptor: string };
  parcelVerified: boolean;
  sources: OfficialSource[];
  note: string;
}

// ── Confident official sources ─────────────────────────────────────────────
// Only real, stable, official portals. These are PORTAL/search links (the
// operator enters the area); we never deep-link a fabricated record.

const NATIONAL_RESEARCH: Array<{ id: string; label: string; name: string; url: (area: string) => string; note: string }> = [
  {
    id: 'census_demographics',
    label: 'Census demographics / growth',
    name: 'U.S. Census Bureau (data.census.gov)',
    url: (area) => `https://data.census.gov/all?q=${encodeURIComponent(area)}`,
    note: 'Official population, growth, and demographics for the local area.',
  },
  {
    id: 'fema_flood',
    label: 'FEMA flood map',
    name: 'FEMA Flood Map Service Center',
    url: () => 'https://msc.fema.gov/portal/home',
    note: 'Official FEMA flood zone / map lookup. Search by address/area on the portal.',
  },
  {
    id: 'usda_soils',
    label: 'USDA soils',
    name: 'USDA NRCS Web Soil Survey',
    url: () => 'https://websoilsurvey.nrcs.usda.gov/app/',
    note: 'Official soil survey (soil types, ag/septic suitability) for the area of interest.',
  },
];

// State-level official property-record portals we are confident about (real
// .gov domains). Used for the county assessor / property-record slot.
const STATE_PROPERTY_RECORDS: Record<string, { name: string; url: string }> = {
  TN: { name: 'Tennessee Comptroller of the Treasury — statewide property assessment', url: 'https://comptroller.tn.gov/' },
};

// County-level confident official sources, keyed "county|state" (lowercased,
// county without the word "County"). Seed ONLY entries confidently known to be
// real/official; everything else is a data_gap with the exact source needed.
interface CountySourceConfig {
  assessor?: { name: string; url: string };
  salesRecords?: { name: string; url: string };
  gis?: { name: string; url: string };
  planning?: { name: string; url: string };
  comprehensivePlan?: { name: string; url: string };
  permits?: { name: string; url: string };
}
const COUNTY_SOURCES: Record<string, CountySourceConfig> = {
  // No county-specific deep URLs are hardcoded yet (none confidently known
  // without a paid/uncertain lookup). Add confident official URLs here as they
  // are confirmed, e.g. 'coffee|tn': { gis: { name, url }, planning: { ... } }.
};

function countyKey(county?: string, state?: string): string {
  return `${(county ?? '').toLowerCase().replace(/\s*county\s*$/i, '').trim()}|${(state ?? '').toLowerCase().trim()}`;
}

function areaDescriptor(city?: string, county?: string, state?: string): string {
  const parts: string[] = [];
  if (county) parts.push(`${county} County`);
  else if (city) parts.push(city);
  if (state) parts.push(state);
  return parts.join(', ') || 'unknown area';
}

/**
 * Build the official-source research card for a verified parcel's county/state
 * or a parsed local-area city/state fallback.
 * National research links are real + on-demand (source_available). County
 * records resolve to a confident official URL where known, else a data_gap with
 * the exact source needed. Pure + deterministic; no network, no fabrication.
 */
export function buildOfficialSources(input: {
  city?: string;
  county?: string;
  state?: string;
  parcelVerified: boolean;
}): OfficialSourcesCard {
  const descriptor = areaDescriptor(input.city, input.county, input.state);
  const stateUp = (input.state ?? '').toUpperCase();
  const sources: OfficialSource[] = [];

  // National research — always real/official when we know the area at all.
  if (input.county || input.state) {
    for (const r of NATIONAL_RESEARCH) {
      sources.push({
        id: r.id,
        label: r.label,
        group: 'national_research',
        status: 'source_available',
        sourceName: r.name,
        sourceUrl: r.url(descriptor),
        note: r.note,
      });
    }
  }

  // County / state official records.
  const cfg = COUNTY_SOURCES[countyKey(input.county, input.state)] ?? {};
  const stateRec = STATE_PROPERTY_RECORDS[stateUp];

  // Assessor / property record — prefer a county config, else the state portal.
  if (cfg.assessor) {
    sources.push({ id: 'county_assessor', label: 'County assessor / property records', group: 'county_records', status: 'source_available', sourceName: cfg.assessor.name, sourceUrl: cfg.assessor.url, note: `Official property-record search for ${descriptor}.` });
  } else if (stateRec) {
    sources.push({ id: 'county_assessor', label: 'County assessor / property records', group: 'county_records', status: 'source_available', sourceName: stateRec.name, sourceUrl: stateRec.url, note: `Statewide official property-record portal covering ${descriptor}. Search the county/parcel there.` });
  } else {
    sources.push({ id: 'county_assessor', label: 'County assessor / property records', group: 'county_records', status: 'data_gap', note: `No confident official assessor URL on file for ${descriptor}.`, approvalNeeded: `Provide/confirm the official ${descriptor} assessor / property-record search URL.` });
  }

  // The remaining county records resolve from config or data_gap.
  const countyOnly: Array<{ id: string; label: string; key: keyof CountySourceConfig; need: string }> = [
    { id: 'county_sales_records', label: 'County register of deeds / sales records', key: 'salesRecords', need: `official ${descriptor} register of deeds / sales records URL` },
    { id: 'county_gis', label: 'County GIS (exact search only)', key: 'gis', need: `official ${descriptor} GIS URL (must support exact address/APN/owner search; no coordinate/map-pin lookup)` },
    { id: 'county_planning', label: 'Planning / zoning department', key: 'planning', need: `official ${descriptor} planning/zoning department URL` },
    { id: 'comprehensive_plan', label: 'Comprehensive plan / future land use', key: 'comprehensivePlan', need: `official ${descriptor} comprehensive plan / future-land-use URL` },
    { id: 'permits_subdivision', label: 'Permits / subdivision portal', key: 'permits', need: `official ${descriptor} permits / subdivision portal URL` },
  ];
  for (const c of countyOnly) {
    const entry = cfg[c.key];
    if (entry) {
      sources.push({ id: c.id, label: c.label, group: 'county_records', status: 'source_available', sourceName: entry.name, sourceUrl: entry.url, note: `Official source for ${descriptor}.` });
    } else {
      sources.push({ id: c.id, label: c.label, group: 'county_records', status: 'data_gap', note: `No confident official URL on file for ${descriptor}.`, approvalNeeded: `Provide/confirm the ${c.need}.` });
    }
  }

  return {
    area: { city: input.city, county: input.county, state: input.state, descriptor },
    parcelVerified: input.parcelVerified,
    sources,
    note: 'Official/public source links are on-demand research pointers, not fabricated facts. County-specific records show a data gap with the exact source needed until a confident official URL is configured. No coordinates/geocoders, no scraping, no paid tools.',
  };
}
