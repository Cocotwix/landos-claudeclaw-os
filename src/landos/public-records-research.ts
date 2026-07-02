// LandOS — Public Records Research Plan v1 (pure, deterministic, free).
//
// When structured provider resolution fails or is incomplete, a competent land
// assistant does not give up — it goes to the public record. This module builds
// the prioritized list of official county sources a human would check, with real
// clickable URLs, and turns the gaps into concrete next verification actions.
//
// Hard rules:
//   - A county SOURCE is never a FACT. These are places to look, not answers.
//     Facts are only recorded when a page/source actually supports them (that
//     happens elsewhere, via attachCardSourceEvidence / browser facts).
//   - Prioritize official county records: GIS, assessor, appraisal district, tax,
//     property appraiser, parcel search, NETR county-records hub, official pages.
//   - No coordinate/proximity/nearest-parcel identity. Search by exact
//     identifiers only (APN, owner, address).
//   - Pure + deterministic. No network here; the URLs are for the operator/agent.

export type ResearchTargetKind =
  | 'netr'
  | 'appraisal_district'
  | 'assessor'
  | 'gis'
  | 'tax'
  | 'property_appraiser'
  | 'parcel_search'
  | 'official_county';

export interface ResearchTarget {
  /** 1 = check first. */
  priority: number;
  kind: ResearchTargetKind;
  label: string;
  /** A real, clickable URL: a county-records hub or an official-source search. */
  url: string;
  /** Facts to try to extract from this source. */
  whatToExtract: string[];
  /** How to search this source (by the exact identifiers the lead provided). */
  searchBy: string[];
  official: boolean;
  note: string;
}

export interface PublicRecordsResearchPlan {
  area: { county?: string; state?: string; city?: string };
  /** Needs at least a state; county makes it precise. */
  eligible: boolean;
  targets: ResearchTarget[];
  /** Core parcel facts the lead still needs (owner/APN/acreage/identity). */
  missingCriticalFacts: string[];
  /** The single most useful next verification action. */
  nextVerificationAction: string;
  /** Always-on reminder that targets are where to look, not facts. */
  disclaimer: string;
}

// State-specific name for the primary official property-record office.
const STATE_OFFICE: Record<string, { kind: ResearchTargetKind; label: string }> = {
  TX: { kind: 'appraisal_district', label: 'County Appraisal District (CAD)' },
  FL: { kind: 'property_appraiser', label: 'County Property Appraiser' },
  LA: { kind: 'assessor', label: 'Parish Assessor' },
};
const DEFAULT_OFFICE = { kind: 'assessor' as ResearchTargetKind, label: 'County Assessor' };

// Full state name -> USPS 2-letter (only what we need to build NETR paths).
const STATE_ABBR: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO',
  connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID',
  illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA',
  maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN',
  mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR',
  pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD',
  tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA',
  'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
};

function normState(state?: string): string | undefined {
  const s = (state ?? '').trim();
  if (!s) return undefined;
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
  return STATE_ABBR[s.toLowerCase()] ?? undefined;
}

/** A Google search scoped to official sources for a county topic. Real + useful
 *  when a county has no single stable deep-link. */
function officialSearchUrl(query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

function cleanCounty(county?: string): string | undefined {
  const c = (county ?? '').trim().replace(/\s+county$/i, '').trim();
  return c || undefined;
}

/**
 * Build the public-records research plan for a lead. Deterministic. Produces the
 * prioritized official county sources + how to search them + the concrete next
 * verification action. Never asserts a fact.
 */
export function buildPublicRecordsResearchPlan(input: {
  county?: string;
  state?: string;
  city?: string;
  apn?: string;
  owner?: string;
  address?: string;
  /** Which core facts are already known (so we don't re-list them as missing). */
  known?: { owner?: boolean; apn?: boolean; acreage?: boolean; parcelIdentity?: boolean };
}): PublicRecordsResearchPlan {
  const county = cleanCounty(input.county);
  const st = normState(input.state);
  const stateDisplay = input.state?.trim() || st || '';
  const area = { county, state: stateDisplay || undefined, city: input.city?.trim() || undefined };
  const eligible = !!(st || county);

  const disclaimer =
    'These are official sources to CHECK, not facts. Record a fact only when the source page actually supports it (owner/APN/acreage), then attach it as evidence.';

  if (!eligible) {
    return {
      area, eligible: false, targets: [], missingCriticalFacts: [],
      nextVerificationAction: 'Provide a county + state (or APN + county) so official county sources can be targeted.',
      disclaimer,
    };
  }

  const countyLabel = county ? `${county} County` : 'the county';
  const geo = [county ? `${county} County` : '', stateDisplay].filter(Boolean).join(', ');
  const office = (st && STATE_OFFICE[st]) || DEFAULT_OFFICE;
  // "Runnels County Appraisal District (CAD)" / "Polk County Property Appraiser"
  // / "Lexington County Assessor" — never a doubled "County County".
  const officeName = county ? `${county} ${office.label}` : office.label;

  // How to search (exact identifiers only — never coordinates/proximity).
  const searchBy: string[] = [];
  if (input.apn) searchBy.push(`APN / parcel #: ${input.apn}`);
  if (input.owner) searchBy.push(`Owner name: ${input.owner}`);
  if (input.address) searchBy.push(`Situs address: ${input.address}`);
  if (searchBy.length === 0) searchBy.push('Provide APN, owner name, or the situs address to run an exact search.');

  const extractAll = ['owner', 'APN / parcel #', 'acreage', 'legal description', 'situs address', 'tax status'];

  const targets: ResearchTarget[] = [];

  // 1. NETR Online county-records hub — the fastest map to the right official
  //    assessor/GIS/tax pages for this county.
  targets.push({
    priority: 1, kind: 'netr', official: true,
    label: `NETR Online — ${countyLabel} public records`,
    url: st && county
      ? `https://publicrecords.netronline.com/state/${st}/county/${encodeURIComponent(county)}`
      : officialSearchUrl(`${geo} NETR Online public records assessor GIS`),
    whatToExtract: ['links to official assessor', 'GIS', 'tax records'],
    searchBy: ['Open the county, then follow the official assessor / GIS / tax links.'],
    note: 'Directory hub → official county sources. Prefer the assessor/appraisal record over interactive GIS.',
  });

  // 2. Primary official property record (state-aware): CAD / Property Appraiser /
  //    Assessor — the authoritative owner + APN + acreage source.
  targets.push({
    priority: 1, kind: office.kind, official: true,
    label: `${officeName} — property search`,
    url: officialSearchUrl(`${geo} ${office.label} property search`),
    whatToExtract: extractAll,
    searchBy,
    note: 'Authoritative owner / APN / acreage / legal description. Search by exact identifier.',
  });

  // 3. County GIS / parcel viewer — parcel boundary + APN confirmation.
  targets.push({
    priority: 2, kind: 'gis', official: true,
    label: `${countyLabel} GIS / parcel viewer`,
    url: officialSearchUrl(`${geo} county GIS parcel viewer property search`),
    whatToExtract: ['APN / parcel #', 'acreage', 'parcel boundary', 'situs address'],
    searchBy,
    note: 'Confirms parcel boundary + APN. Use for corroboration; assessor record is authoritative for owner.',
  });

  // 4. County tax office — tax status + owner-of-record corroboration.
  targets.push({
    priority: 2, kind: 'tax', official: true,
    label: `${countyLabel} tax office — property tax records`,
    url: officialSearchUrl(`${geo} county tax office property tax records search`),
    whatToExtract: ['owner-of-record', 'tax status / delinquency', 'assessed value'],
    searchBy,
    note: 'Corroborates owner and surfaces delinquency (a motivation + risk signal).',
  });

  // 5. Register/clerk of deeds — recorded deed (owner of record + legal desc).
  targets.push({
    priority: 3, kind: 'official_county', official: true,
    label: `${countyLabel} clerk / register of deeds — recorded deed`,
    url: officialSearchUrl(`${geo} county clerk register of deeds recorded deed search`),
    whatToExtract: ['recorded deed (owner of record)', 'legal description'],
    searchBy,
    note: 'Recorded deed is the strongest owner-of-record + legal description evidence.',
  });

  // Missing critical facts (drive the next action).
  const known = input.known ?? {};
  const missingCriticalFacts: string[] = [];
  if (!known.parcelIdentity) missingCriticalFacts.push('Verified parcel identity');
  if (!known.owner) missingCriticalFacts.push('Owner');
  if (!known.apn) missingCriticalFacts.push('APN / parcel number');
  if (!known.acreage) missingCriticalFacts.push('Acreage');

  const idHint = input.apn ? `APN ${input.apn}` : input.owner ? `owner "${input.owner}"` : input.address ? `address "${input.address}"` : 'the lead';
  const nextVerificationAction = county || st
    ? `Open the ${officeName} property search and look up ${idHint} to confirm owner, APN, and acreage; then attach the official record as source evidence.`
    : 'Establish county + state, then run the county property search.';

  return { area, eligible: true, targets, missingCriticalFacts, nextVerificationAction, disclaimer };
}

/** Turn the research plan into concrete next-action strings for the subject card.
 *  Each is a real, doable step (open source X, search by identifier Y). */
export function researchPlanNextActions(plan: PublicRecordsResearchPlan): string[] {
  if (!plan.eligible) return [plan.nextVerificationAction];
  const out: string[] = [plan.nextVerificationAction];
  for (const t of plan.targets.filter((x) => x.priority === 1)) {
    out.push(`Check ${t.label}: ${t.url}`);
  }
  return out;
}
