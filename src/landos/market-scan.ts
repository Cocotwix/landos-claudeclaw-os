// Market Scan — land-relevance filtering + Data Center Watch.
//
// The Market tab answers ONE question: "Should I want land here?" Every signal
// it shows must pass the land-investment relevance test — it must affect land
// demand, land value, or an exit strategy — and must carry a plain "why this
// matters for buying this land" line. Anything that can't answer that question
// is dropped, never shown.
//
// Data Center Watch is an EXISTENCE CHECK, not a deep investigation: does this
// county/region have 2025+ data-center / AI-campus activity (proposed, approved,
// under construction, expansions, related utility infrastructure, planning
// activity, or community opposition)? If found: summarize + say why it matters;
// deeper research is a later Jarvis task.
//
// The cores here are PURE (findings in → classified scan out) so they are fully
// testable offline. The live search runner is injected by the route layer.

// ── Land-investment relevance ────────────────────────────────────────────────

export type RelevanceCategory =
  | 'population_growth'
  | 'major_employer'
  | 'employer_closure'
  | 'subdivision'
  | 'master_planned_community'
  | 'residential_development'
  | 'commercial_development'
  | 'industrial_project'
  | 'manufacturing'
  | 'distribution'
  | 'water_expansion'
  | 'sewer_expansion'
  | 'highway_project'
  | 'transportation_improvement'
  | 'annexation'
  | 'rezoning'
  | 'permit_growth'
  | 'building_trend'
  | 'data_center'
  | 'ai_campus'
  | 'utility_infrastructure';

interface RelevanceRule {
  category: RelevanceCategory;
  test: RegExp;
  whyItMatters: string;
}

// Ordered: more specific categories first. Each carries the operator-facing
// "why does this matter for buying this land?" answer.
const RELEVANCE_RULES: RelevanceRule[] = [
  { category: 'data_center', test: /\bdata center|datacenter|hyperscale|colocation\b/i, whyItMatters: 'Data-center projects bring land acquisition at scale, utility buildout, and a wave of land demand around the site.' },
  { category: 'ai_campus', test: /\bai (campus|factory|infrastructure|cluster)|gpu (cluster|farm)\b/i, whyItMatters: 'AI-compute campuses drive large-parcel acquisition and long-horizon land appreciation nearby.' },
  { category: 'commercial_development', test: /\bcommercial (project|development|construction)|mixed[- ]use|retail (center|development|project)\b/i, whyItMatters: 'Commercial investment follows household growth and can widen nearby residential and business land demand.' },
  { category: 'industrial_project', test: /\bindustrial (project|development|campus|facility|park)\b/i, whyItMatters: 'Industrial investment brings jobs, infrastructure and downstream housing demand that can improve land absorption.' },
  { category: 'transportation_improvement', test: /\b(road|bridge|rail|transit|transportation)\b.{0,24}\b(project|widening|expansion|construction|improvement)\b/i, whyItMatters: 'Transportation improvements can change access, commute patterns and development pressure around land.' },
  { category: 'annexation', test: /\bannex(?:ation|ed|ing)\b/i, whyItMatters: 'Annexation can change services, taxes and development rules, materially changing a land exit.' },
  { category: 'master_planned_community', test: /\bmaster[- ]planned\b/i, whyItMatters: 'A master-planned community pulls thousands of future residents — nearby raw land rides its demand curve.' },
  { category: 'subdivision', test: /\bsubdivision|platted lots|new phase of\b/i, whyItMatters: 'Active subdividing means builders are buying land here — direct evidence of land demand and a subdivide exit.' },
  { category: 'residential_development', test: /\b(new homes?|housing development|apartment|residential (project|development|construction))\b/i, whyItMatters: 'Residential construction absorbs land and lifts surrounding land values.' },
  { category: 'employer_closure', test: /\b(closure|closing|shut(ting)? down|layoffs?|plant closes)\b/i, whyItMatters: 'A major employer leaving weakens land demand and exit pricing — a value risk, not a driver.' },
  { category: 'manufacturing', test: /\b(manufactur|factory|plant (opens|announced|expansion)|industrial park)\b/i, whyItMatters: 'Manufacturing jobs bring workers who need housing — a durable land-demand driver.' },
  { category: 'distribution', test: /\b(distribution (center|hub)|warehouse|logistics (center|hub|park)|fulfillment)\b/i, whyItMatters: 'Distribution hubs bring jobs and truck-route infrastructure, both of which raise nearby land utility.' },
  { category: 'water_expansion', test: /\bwater (line|main|system|service|utility) (extension|expansion|project)|county water\b/i, whyItMatters: 'Water reaching un-served land can step-change its value and unlock building exits.' },
  { category: 'sewer_expansion', test: /\bsewer (line|extension|expansion|project|service)\b/i, whyItMatters: 'Sewer availability removes the septic constraint and widens the buyer pool for land.' },
  { category: 'highway_project', test: /\b(highway|interstate|bypass|interchange|corridor)\b.{0,24}\b(project|widening|expansion|construction|improvement)\b/i, whyItMatters: 'Highway projects change access and traffic patterns — land along improved corridors re-prices.' },
  { category: 'rezoning', test: /\brezon(e|ing)|zoning (change|amendment)\b/i, whyItMatters: 'Rezonings signal where the county is steering growth — and what exits nearby parcels may gain.' },
  { category: 'permit_growth', test: /\b(building permits?|permit (activity|growth|surge))\b/i, whyItMatters: 'Permit growth is the leading indicator that builders are absorbing land here.' },
  { category: 'building_trend', test: /\b(construction (boom|activity|trend)|housing (boom|growth|demand))\b/i, whyItMatters: 'Broad building momentum supports land liquidity and firmer exit pricing.' },
  { category: 'population_growth', test: /\bpopulation (growth|grew|boom|increase|decline|loss)|fastest[- ]growing\b/i, whyItMatters: 'Population direction is the base rate for land demand — growth widens the buyer pool, decline shrinks it.' },
  { category: 'major_employer', test: /\b(major employer|new employer|jobs? (announced|coming)|hiring \d+|employer (expansion|announce))\b/i, whyItMatters: 'New jobs bring housing demand, and housing demand starts with land.' },
  { category: 'utility_infrastructure', test: /\b(substation|transmission line|power (plant|grid|capacity)|electric utility|natural gas line)\b/i, whyItMatters: 'Utility capacity buildout precedes development — infrastructure spend marks tomorrow’s growth path.' },
];

export interface RelevanceAssessment {
  relevant: boolean;
  category: RelevanceCategory | null;
  whyItMatters: string | null;
}

/** Every item shown on Market must answer "why does this matter for buying this
 *  land?" — this is that filter. Irrelevant text returns relevant:false and is
 *  never rendered. */
export function assessLandRelevance(text: string): RelevanceAssessment {
  const t = (text ?? '').trim();
  if (!t) return { relevant: false, category: null, whyItMatters: null };
  // When a project description also names a rezoning/annexation action, the
  // governing action is the more decision-useful classification.
  for (const priority of ['annexation', 'rezoning'] as const) {
    const rule = RELEVANCE_RULES.find((candidate) => candidate.category === priority);
    if (rule?.test.test(t)) return { relevant: true, category: rule.category, whyItMatters: rule.whyItMatters };
  }
  for (const rule of RELEVANCE_RULES) {
    if (rule.test.test(t)) return { relevant: true, category: rule.category, whyItMatters: rule.whyItMatters };
  }
  return { relevant: false, category: null, whyItMatters: null };
}

// ── Findings (search results in the loose shape the cores consume) ──────────

export interface ScanFinding {
  title: string;
  summary: string;
  url?: string | null;
  /** Publication year when the source stated one. Undated items are kept. */
  year?: number | null;
  /** Structured fields are retained only when the live researcher established
   * them. The projection never infers distance or scale from a headline. */
  location?: string | null;
  distanceMiles?: number | null;
  status?: string | null;
  timeline?: string | null;
  scale?: string | null;
  downside?: string | null;
}

// ── Data Center Watch ────────────────────────────────────────────────────────

export type DataCenterItemStatus =
  | 'proposed'
  | 'approved'
  | 'under_construction'
  | 'expansion'
  | 'utility_infrastructure'
  | 'planning_activity'
  | 'community_opposition'
  | 'mention';

export interface DataCenterWatchItem {
  title: string;
  operatorOrDeveloper?: string | null;
  location?: string | null;
  distanceMiles?: number | null;
  status: DataCenterItemStatus;
  summary: string;
  whyItMatters: string;
  url: string | null;
  year: number | null;
  /** Which lane carried this item. Named so a ZIP-centroid community report is
   *  never read as a confirmed sited project. */
  source?: 'brockovich_community_reports' | 'web_search' | 'brockovich_map' | null;
  /**
   * How this item's LOCATION is known, which is a separate question from
   * whether the project is real:
   *   subject_area_named — the source names the subject's county/city/ZIP/state
   *   distance_verified  — the place was resolved and measured to the subject
   *   unverified         — topical and possibly nearby, location not established
   * Only the first two may be counted as a within-radius hit.
   */
  locationConfidence?: 'subject_area_named' | 'distance_verified' | 'unverified';
  /** A second, independent source that corroborates a proposed / rumored item,
   *  when one was found. Null means uncorroborated, never disproven. */
  corroboration?: { summary: string; url: string | null } | null;
}

export interface DataCenterWatch {
  status: 'found' | 'none_found' | 'not_run' | 'unavailable';
  area: string;
  items: DataCenterWatchItem[];
  /** The one-paragraph operator read. */
  summary: string;
  whyItMatters: string;
  /** Existence check only — deeper research is a later, explicit task. */
  note: string;
  generatedAt: string;
  /**
   * The explicit answer to "is there a data center near this subject?" — always
   * present, in every status. A hit names what, its status and its approximate
   * distance; a clean screen says so plainly rather than leaving the operator to
   * infer it from an empty list.
   */
  verdict?: string;
  /** Every retrieval route actually attempted, named so a negative answer can be
   *  read as "these routes found nothing", never as "LandOS did not look". */
  routesAttempted?: string[];
  /**
   * Topical data-center activity that may or may not be near the subject: the
   * source did not name the subject's geography and its location could not be
   * established. Carried as context so a possibly-nearby project is never
   * silently discarded, and kept OUT of `items` so it is never counted as a
   * confirmed within-20-mile hit.
   */
  unverifiedNearbyCandidates?: DataCenterWatchItem[];
  browserMapEvidence?: {
    sourceUrl: string;
    subject: { lat: number; lng: number };
    radiusMiles: number;
    screenshotPath: string | null;
    attemptedAt: string;
  } | null;
}

const DC_STATUS_RULES: Array<{ status: DataCenterItemStatus; test: RegExp }> = [
  { status: 'under_construction', test: /\bunder construction|breaking ground|broke ground|construction (has )?(begun|started)\b/i },
  { status: 'approved', test: /\bapproved?|green[- ]?li(t|ght)|permit (granted|issued)|rezoning approved\b/i },
  { status: 'community_opposition', test: /\bopposition|opponents?|protest|residents (fight|oppose)|pushback|moratorium\b/i },
  { status: 'expansion', test: /\bexpansion|expand(s|ing)?|additional (phase|capacity)\b/i },
  { status: 'utility_infrastructure', test: /\bsubstation|transmission|power (line|capacity|agreement)|water agreement|utility\b/i },
  { status: 'planning_activity', test: /\bplanning (commission|board|application)|proposal under review|public hearing|comprehensive plan\b/i },
  { status: 'proposed', test: /\bproposed?|plans? (for|to build)|would build|seeking (approval|rezoning)\b/i },
];

const DC_WHY: Record<DataCenterItemStatus, string> = {
  proposed: 'A proposed data center puts institutional land buyers in this market before prices move.',
  approved: 'An approved data center locks in utility buildout and long-term land demand nearby.',
  under_construction: 'Construction underway means the land-demand wave is already arriving — nearby parcels re-price.',
  expansion: 'An expanding campus keeps absorbing land and utilities — sustained demand, not a one-off.',
  utility_infrastructure: 'Data-center-scale utility work marks the growth corridor before the buildings do.',
  planning_activity: 'Planning activity shows the county is actively courting or processing data-center land use.',
  community_opposition: 'Opposition can stall or kill projects — factor timing risk into any exit that depends on it.',
  mention: 'Data-center interest in the area is a forward signal for institutional land demand.',
};

function classifyDataCenterStatus(text: string): DataCenterItemStatus {
  for (const rule of DC_STATUS_RULES) {
    if (rule.test.test(text)) return rule.status;
  }
  return 'mention';
}

const DC_TOPIC = /\bdata ?center|hyperscale|colocation|ai (campus|factory|infrastructure|cluster)|gpu (cluster|farm)\b/i;

// ── Geographic relevance ────────────────────────────────────────────────────
//
// Web search answers the QUESTION asked, not the GEOGRAPHY asked about. A
// keyless query for "Barry, MO data center" returns national data-center news:
// a Laramie County, Wyoming approval and a Paducah, Kentucky campus both come
// back topical and both are about somewhere else. Passing those through told
// the operator this county has data-center activity when it does not, which is
// worse than saying nothing.
//
// So a finding must NAME the subject's own geography — its county, state, city
// or ZIP — to be kept. Anything else is dropped and counted, never rendered.

const STATE_NAME: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
  CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho',
  IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
  NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina',
  ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas',
  UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia',
  WI: 'Wisconsin', WY: 'Wyoming', DC: 'District of Columbia',
};

export interface SubjectPlace {
  county?: string;
  state?: string;
  city?: string;
  zip?: string;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Does this finding actually name the subject's geography? PURE.
 * With no resolvable place, nothing can be screened, so everything passes —
 * an unknown geography must not silently empty the scan.
 */
export function mentionsSubjectArea(text: string, place: SubjectPlace): boolean {
  const terms: string[] = [];
  const county = (place.county ?? '').replace(/\s+county$/i, '').trim();
  const city = (place.city ?? '').trim();
  const zip = (place.zip ?? '').trim();
  const state = (place.state ?? '').trim().toUpperCase();
  if (county.length >= 3) terms.push(county);
  if (city.length >= 3) terms.push(city);
  if (/^\d{5}$/.test(zip)) terms.push(zip);
  if (STATE_NAME[state]) terms.push(STATE_NAME[state]);
  if (!terms.length) return true;
  const haystack = text ?? '';
  if (terms.some((term) => new RegExp(`\\b${escapeRegex(term)}\\b`, 'i').test(haystack))) return true;
  // A bare two-letter state code only counts beside a place name ("Cassville,
  // MO"), never on its own — "MO" appears inside too much unrelated text.
  return /^[A-Z]{2}$/.test(state)
    && new RegExp(`[A-Za-z]{3,},\\s*${state}\\b`).test(haystack);
}

/**
 * Build the Data Center Watch from search findings. PURE. Keeps only 2025+
 * (or undated) findings that are actually about data-center / AI-compute
 * activity; classifies each; never fabricates: no findings in → none_found,
 * no search run → not_run.
 */
export function buildDataCenterWatch(input: {
  county?: string;
  state?: string;
  /** City and ZIP widen the geographic screen below; both are optional. */
  city?: string;
  zip?: string;
  findings: ScanFinding[] | null; // null = the search did not run
  searchFailed?: boolean;
  nowIso?: string;
}): DataCenterWatch {
  const area = [input.county, input.state].filter(Boolean).join(', ') || 'this area';
  const generatedAt = input.nowIso ?? new Date().toISOString();
  const note = 'Existence check only (2025+). If this matters to the deal, queue deeper Jarvis research — this scan does not investigate.';

  if (input.searchFailed) {
    return {
      status: 'unavailable', area, items: [],
      summary: `Data Center Watch could not complete for ${area} — the search source was unavailable.`,
      whyItMatters: '', note, generatedAt,
      verdict: `Whether a data center sits near this subject is UNRESOLVED for ${area}: every search transport failed. This is a source outage, not evidence that nothing is nearby.`,
    };
  }
  if (input.findings == null) {
    return {
      status: 'not_run', area, items: [],
      summary: `Data Center Watch has not run for ${area} yet.`,
      whyItMatters: '', note, generatedAt,
      verdict: `The data-center check has not run for ${area} yet, so nothing is claimed either way.`,
    };
  }

  const place: SubjectPlace = { county: input.county, state: input.state, city: input.city, zip: input.zip };
  const items: DataCenterWatchItem[] = [];
  const unverified: DataCenterWatchItem[] = [];
  for (const f of input.findings) {
    const text = `${f.title} ${f.summary}`;
    if (!DC_TOPIC.test(text)) continue;                       // not data-center activity
    if (f.year != null && f.year < 2025) continue;            // 2025+ only
    const status = classifyDataCenterStatus(text);
    const namesSubjectArea = mentionsSubjectArea(text, place);
    const item: DataCenterWatchItem = {
      title: (f.title || '').trim() || 'Data center activity',
      location: f.location?.trim() || null,
      distanceMiles: typeof f.distanceMiles === 'number' && Number.isFinite(f.distanceMiles)
        ? f.distanceMiles : null,
      status,
      summary: (f.summary || '').trim(),
      whyItMatters: DC_WHY[status],
      url: (f.url && f.url.trim()) || null,
      year: f.year ?? null,
      source: 'web_search',
      corroboration: null,
      locationConfidence: namesSubjectArea ? 'subject_area_named' : 'unverified',
    };
    // A source that does not name the subject's geography is NOT evidence the
    // project is far away — search returns national coverage. It is held as an
    // unverified candidate whose location the caller may still resolve, and it
    // never counts as a confirmed within-radius hit until a distance is
    // actually measured.
    if (namesSubjectArea) items.push(item); else unverified.push(item);
  }

  if (!items.length) {
    const candidateNote = unverified.length
      ? ` ${unverified.length} topical result(s) did not name this market and their locations were not established; they are carried as unverified context, not as nearby activity.`
      : '';
    return {
      status: 'none_found', area, items: [],
      unverifiedNearbyCandidates: unverified.slice(0, 6),
      summary: `No 2025+ data-center or AI-campus activity confirmed for ${area}. That is a real answer, not a gap — this market shows no confirmed institutional compute demand signal right now.${candidateNote}`,
      whyItMatters: '', note, generatedAt,
      verdict: `Indexed and grounded web search confirmed no operating, under-construction, proposed or rumored data-center activity in ${area}.${candidateNote} Search results are county-scoped, so this does not itself measure a 20-mile radius.`,
    };
  }

  const strongest = items.find((i) => i.status === 'under_construction') ?? items.find((i) => i.status === 'approved') ?? items[0];
  const statuses = Array.from(new Set(items.map((i) => i.status.replace(/_/g, ' '))));
  const candidateTail = unverified.length
    ? ` ${unverified.length} further topical result(s) are carried as unverified context, their locations unestablished.`
    : '';
  return {
    status: 'found', area, items: items.slice(0, 6),
    unverifiedNearbyCandidates: unverified.slice(0, 6),
    summary: `Data-center / AI-campus activity found near ${area}: ${items.length} signal(s) — ${statuses.join(', ')}. Strongest: ${strongest.title}.${candidateTail}`,
    whyItMatters: strongest.whyItMatters,
    note, generatedAt,
    verdict: `Web search reports data-center activity in ${area}: ${items.length} signal(s) (${statuses.join(', ')}). Strongest: ${strongest.title}.${candidateTail} Search findings are county-scoped; distance from the subject is only established where a lane measured it.`,
  };
}

// ── The county land-market web read (price direction, liquidity narrative) ───
//
// The retained Market Research store answers the NUMBERS — sold volume, median
// $/acre, DOM, sell-through, absorption, months of supply — but currently holds
// a single quarter for most counties, so it cannot state a price TREND. Rather
// than leave the operator's "which way is pricing moving?" question unanswered,
// this lane carries sourced web evidence about the subject county's land market
// at the subject's acreage range, verbatim and attributed. It classifies
// nothing and infers nothing: it is evidence, next to the numbers.

export interface LandMarketWebItem {
  title: string;
  summary: string;
  url: string | null;
  year: number | null;
}

export interface LandMarketWebRead {
  status: 'found' | 'none_found' | 'not_run' | 'unavailable';
  area: string;
  /** The acreage range the query targeted, when the subject's acreage is known. */
  acreageFocus: string | null;
  items: LandMarketWebItem[];
  summary: string;
  generatedAt: string;
}

export const LAND_MARKET_QUERY = (area: string, acreageFocus: string | null): string =>
  `${area} vacant land market ${acreageFocus ? `${acreageFocus} acre tracts ` : ''}`
  + 'price per acre trend days on market inventory absorption 2025 2026 land values rising or falling';

/** The acreage range a subject belongs to, phrased the way a search would be. */
export function acreageFocusLabel(acres: number | null | undefined): string | null {
  if (typeof acres !== 'number' || !Number.isFinite(acres) || acres <= 0) return null;
  const band = PRACTICAL_ACREAGE_BANDS.find((entry) => acres >= entry.min && (entry.max == null || acres < entry.max));
  if (!band) return null;
  return band.max == null ? `${band.min}+` : `${band.min}-${band.max}`;
}

/** PURE. Keeps web findings that actually speak to land pricing, liquidity or
 *  market direction; anything else is dropped rather than padded in. */
export function buildLandMarketWebRead(input: {
  county?: string;
  state?: string;
  city?: string;
  zip?: string;
  acreageFocus?: string | null;
  findings: ScanFinding[] | null;
  searchFailed?: boolean;
  nowIso?: string;
}): LandMarketWebRead {
  const area = [input.county, input.state].filter(Boolean).join(', ') || 'this area';
  const generatedAt = input.nowIso ?? new Date().toISOString();
  const acreageFocus = input.acreageFocus ?? null;
  const base = { area, acreageFocus, generatedAt };
  if (input.searchFailed) {
    return { ...base, status: 'unavailable', items: [], summary: `The land-market web read could not complete for ${area} — every search transport failed.` };
  }
  if (input.findings == null) {
    return { ...base, status: 'not_run', items: [], summary: `The land-market web read has not run for ${area} yet.` };
  }
  const MARKET_TOPIC = /\b(price per acre|\$\/acre|land (value|price|market|sales)|days on market|inventory|absorption|acre(age)? (lot|tract|parcel)s?|median (price|sale)|sell[- ]through|for sale)\b/i;
  const place: SubjectPlace = { county: input.county, state: input.state, city: input.city, zip: input.zip };
  const items = input.findings
    .filter((finding) => MARKET_TOPIC.test(`${finding.title} ${finding.summary}`)
      && mentionsSubjectArea(`${finding.title} ${finding.summary}`, place))
    .map((finding) => ({
      title: (finding.title || '').trim() || 'Land market source',
      summary: (finding.summary || '').trim(),
      url: (finding.url && finding.url.trim()) || null,
      year: finding.year ?? null,
    }))
    .slice(0, 6);
  if (!items.length) {
    return { ...base, status: 'none_found', items: [], summary: `No sourced web evidence about the ${area} land market surfaced in this scan.` };
  }
  return {
    ...base,
    status: 'found',
    items,
    summary: `${items.length} sourced web reference(s) on the ${area} land market`
      + `${acreageFocus ? ` at the subject's ${acreageFocus} acre range` : ''}. Read alongside the retained Market Research numbers; these are published claims, not LandOS measurements.`,
  };
}

// ── Growth-signal scan (the general Market feed, relevance-filtered) ─────────

export interface MarketSignalItem {
  title: string;
  summary: string;
  category: RelevanceCategory;
  whyItMatters: string;
  url: string | null;
  year: number | null;
  location: string | null;
  distanceMiles: number | null;
  status: string | null;
  timeline: string | null;
  scale: string | null;
  downside: string | null;
}

export interface MarketSignalScan {
  status: 'found' | 'none_found' | 'not_run' | 'unavailable';
  area: string;
  items: MarketSignalItem[];
  droppedIrrelevant: number;
  summary: string;
  generatedAt: string;
}

/**
 * Filter raw findings through land-investment relevance. Anything that cannot
 * answer "why does this matter for buying this land?" is DROPPED (counted, so
 * the audit can prove the filter ran) — never rendered.
 */
export function buildMarketSignalScan(input: {
  county?: string;
  state?: string;
  city?: string;
  zip?: string;
  findings: ScanFinding[] | null;
  searchFailed?: boolean;
  nowIso?: string;
}): MarketSignalScan {
  const area = [input.county, input.state].filter(Boolean).join(', ') || 'this area';
  const generatedAt = input.nowIso ?? new Date().toISOString();
  if (input.searchFailed) {
    return { status: 'unavailable', area, items: [], droppedIrrelevant: 0, summary: `Growth-signal scan could not complete for ${area}.`, generatedAt };
  }
  if (input.findings == null) {
    return { status: 'not_run', area, items: [], droppedIrrelevant: 0, summary: `Growth-signal scan has not run for ${area} yet.`, generatedAt };
  }
  const place: SubjectPlace = { county: input.county, state: input.state, city: input.city, zip: input.zip };
  const items: MarketSignalItem[] = [];
  let dropped = 0;
  for (const f of input.findings) {
    const text = `${f.title} ${f.summary}`;
    const rel = assessLandRelevance(text);
    if (!rel.relevant || !rel.category || !rel.whyItMatters) { dropped += 1; continue; }
    // Land-relevant somewhere else is not a signal about THIS market.
    if (!mentionsSubjectArea(text, place)) { dropped += 1; continue; }
    items.push({
      title: (f.title || '').trim() || 'Market signal',
      summary: (f.summary || '').trim(),
      category: rel.category,
      whyItMatters: rel.whyItMatters,
      url: (f.url && f.url.trim()) || null,
      year: f.year ?? null,
      location: f.location?.trim() || null,
      distanceMiles: typeof f.distanceMiles === 'number' && Number.isFinite(f.distanceMiles)
        ? f.distanceMiles : null,
      status: f.status?.trim() || null,
      timeline: f.timeline?.trim() || (f.year != null ? String(f.year) : null),
      scale: f.scale?.trim() || null,
      downside: f.downside?.trim()
        || (/closure|opposition|decline|loss|delay|risk/i.test(`${f.title} ${f.summary}`)
          ? (f.summary || '').trim() || 'Potential downside signal.'
          : null),
    });
  }
  if (!items.length) {
    return { status: 'none_found', area, items: [], droppedIrrelevant: dropped, summary: `No land-relevant growth signals found for ${area} in this scan.`, generatedAt };
  }
  return {
    status: 'found', area, items: items.slice(0, 10), droppedIrrelevant: dropped,
    summary: `${items.length} land-relevant signal(s) for ${area}; ${dropped} irrelevant item(s) filtered out.`,
    generatedAt,
  };
}

// ── Practical acreage-band market matrix ────────────────────────────────────

export type PracticalAcreageBand = '50+' | '20-50' | '10-20' | '5-10' | '2-5' | '1-2' | '0-1';

export const PRACTICAL_ACREAGE_BANDS: ReadonlyArray<{
  band: PracticalAcreageBand;
  min: number;
  max: number | null;
}> = [
  { band: '50+', min: 50, max: null },
  { band: '20-50', min: 20, max: 50 },
  { band: '10-20', min: 10, max: 20 },
  { band: '5-10', min: 5, max: 10 },
  { band: '2-5', min: 2, max: 5 },
  { band: '1-2', min: 1, max: 2 },
  { band: '0-1', min: 0, max: 1 },
];

export interface AcreageMarketObservation {
  status: 'sold' | 'active';
  acres: number | null;
  price: number | null;
  dateIso?: string | null;
  daysOnMarket?: number | null;
  source?: string | null;
}

export interface AcreageBandMarketRead {
  band: PracticalAcreageBand;
  soldVolume: number;
  activeInventory: number;
  medianSalePrice: number | null;
  medianPricePerAcre: number | null;
  medianDaysOnMarket: number | null;
  sellThroughRate: number | null;
  /** Native internal Market Research absorption rate, normally a percentage. */
  absorptionRate: number | null;
  /** Closed-sale count divided by the observation lookback. Kept separately so
   * it is never mislabeled as the internal percentage metric. */
  absorptionPerMonth: number | null;
  monthsOfSupply: number | null;
  population: number | null;
  populationDensity: number | null;
  populationGrowth: number | null;
  priceTrend: { direction: 'up' | 'down' | 'flat' | 'insufficient'; percent: number | null };
  likelyResaleTime: string;
  movementRank: number | null;
  snapshotPeriod: string | null;
  confidence: 'high' | 'medium' | 'low' | 'none';
  coverage: string;
  source: string;
  evidence: string;
}

/**
 * Typed handoff from LandOS Market Research. The assembly layer supplies the
 * newest county snapshots for all seven required bands and both market sides;
 * this module projects and ranks them without reading the database.
 */
export interface InternalCountyAcreageSnapshot {
  band: PracticalAcreageBand;
  side: 'sold' | 'for_sale';
  period: string;
  metrics: {
    salesCount?: number | null;
    listingCount?: number | null;
    medianPrice?: number | null;
    medianPricePerAcre?: number | null;
    daysOnMarket?: number | null;
    sellThroughRate?: number | null;
    absorptionRate?: number | null;
    monthsOfSupply?: number | null;
    population?: number | null;
    populationDensity?: number | null;
    populationGrowth?: number | null;
  };
  confidence: 'high' | 'medium' | 'low';
  provider: string;
  sourceRef: string;
  extractionTimestamp: string;
  /** Example: "Pickens County, sold land, 12-month snapshot". */
  coverage: string;
}

export interface PracticalMarketMatrix {
  lookbackMonths: number;
  bands: AcreageBandMarketRead[];
  subjectBand: PracticalAcreageBand | null;
  bulkTractRead: string;
  splitSizeRead: string;
  arbitrage: {
    status: 'supported' | 'not_observed' | 'insufficient';
    bulkPricePerAcre: number | null;
    bestSmallerBand: PracticalAcreageBand | null;
    smallerBandPricePerAcre: number | null;
    premiumPercent: number | null;
    explanation: string;
  };
  bestMovingBands: PracticalAcreageBand[];
}

function numericMedian(values: number[]): number | null {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

export function practicalAcreageBand(acres: number | null | undefined): PracticalAcreageBand | null {
  if (typeof acres !== 'number' || !Number.isFinite(acres) || acres < 0) return null;
  return PRACTICAL_ACREAGE_BANDS.find((entry) =>
    acres >= entry.min && (entry.max == null || acres < entry.max))?.band ?? null;
}

/**
 * Build the matrix from actual sold and active rows. Missing metrics stay null;
 * zero observations never become fake zero DOM, absorption or supply.
 */
export function buildPracticalMarketMatrix(input: {
  observations: AcreageMarketObservation[];
  internalCountySnapshots?: InternalCountyAcreageSnapshot[];
  subjectAcres?: number | null;
  lookbackMonths?: number;
  nowIso?: string;
}): PracticalMarketMatrix {
  const lookbackMonths = input.lookbackMonths ?? 24;
  const nowMs = Date.parse(input.nowIso ?? new Date().toISOString());
  const cutoff = nowMs - lookbackMonths * 30.4 * 86_400_000;
  const rows = input.observations.filter((row) =>
    typeof row.acres === 'number' && row.acres > 0
    && typeof row.price === 'number' && row.price > 0);
  const snapshots = input.internalCountySnapshots ?? [];
  const newestSnapshot = (
    band: PracticalAcreageBand,
    side: InternalCountyAcreageSnapshot['side'],
  ): InternalCountyAcreageSnapshot | null =>
    snapshots
      .filter((snapshot) => snapshot.band === band && snapshot.side === side)
      .sort((a, b) =>
        b.period.localeCompare(a.period)
        || Date.parse(b.extractionTimestamp) - Date.parse(a.extractionTimestamp))[0] ?? null;

  const bands = PRACTICAL_ACREAGE_BANDS.map((definition): AcreageBandMarketRead & { movementScore: number } => {
    const inBand = rows.filter((row) =>
      row.acres! >= definition.min && (definition.max == null || row.acres! < definition.max));
    const sold = inBand.filter((row) => row.status === 'sold'
      && (!row.dateIso || !Number.isFinite(Date.parse(row.dateIso)) || Date.parse(row.dateIso) >= cutoff));
    const active = inBand.filter((row) => row.status === 'active');
    const internalSold = newestSnapshot(definition.band, 'sold');
    const internalActive = newestSnapshot(definition.band, 'for_sale');
    const soldMetrics = internalSold?.metrics ?? {};
    const activeMetrics = internalActive?.metrics ?? {};
    const ppas = sold.map((row) => row.price! / row.acres!);
    const dom = sold.map((row) => row.daysOnMarket).filter((value): value is number =>
      typeof value === 'number' && Number.isFinite(value) && value >= 0);
    const observedAbsorption = sold.length ? sold.length / lookbackMonths : null;
    const observedMonthsSupply = observedAbsorption && observedAbsorption > 0
      ? active.length / observedAbsorption : null;
    const observedSellThrough = sold.length + active.length > 0
      ? sold.length / (sold.length + active.length) * 100 : null;
    const dated = sold.filter((row) => row.dateIso && Number.isFinite(Date.parse(row.dateIso)))
      .sort((a, b) => Date.parse(a.dateIso!) - Date.parse(b.dateIso!));
    let trend: AcreageBandMarketRead['priceTrend'] = { direction: 'insufficient', percent: null };
    if (dated.length >= 4) {
      const half = Math.floor(dated.length / 2);
      const older = numericMedian(dated.slice(0, half).map((row) => row.price! / row.acres!))!;
      const newer = numericMedian(dated.slice(-half).map((row) => row.price! / row.acres!))!;
      const percent = older > 0 ? ((newer - older) / older) * 100 : 0;
      trend = {
        direction: percent > 3 ? 'up' : percent < -3 ? 'down' : 'flat',
        percent: Math.round(percent * 10) / 10,
      };
    }
    const internalHistory = snapshots
      .filter((snapshot) => snapshot.band === definition.band
        && snapshot.side === 'sold'
        && typeof snapshot.metrics.medianPricePerAcre === 'number')
      .sort((a, b) => b.period.localeCompare(a.period));
    if (trend.direction === 'insufficient' && internalHistory.length >= 2) {
      const current = internalHistory[0].metrics.medianPricePerAcre!;
      const prior = internalHistory[1].metrics.medianPricePerAcre!;
      const percent = prior > 0 ? ((current - prior) / prior) * 100 : 0;
      trend = {
        direction: percent > 3 ? 'up' : percent < -3 ? 'down' : 'flat',
        percent: Math.round(percent * 10) / 10,
      };
    }
    const medianDom = soldMetrics.daysOnMarket ?? numericMedian(dom);
    const soldVolume = soldMetrics.salesCount ?? sold.length;
    const activeInventory = activeMetrics.listingCount ?? soldMetrics.listingCount ?? active.length;
    const medianSalePrice = soldMetrics.medianPrice ?? numericMedian(sold.map((row) => row.price!));
    const medianPricePerAcre = soldMetrics.medianPricePerAcre ?? numericMedian(ppas);
    const sellThrough = soldMetrics.sellThroughRate ?? observedSellThrough;
    const absorptionRate = soldMetrics.absorptionRate ?? null;
    const absorptionPerMonth = internalSold ? null : observedAbsorption;
    const monthsSupply = soldMetrics.monthsOfSupply
      ?? activeMetrics.monthsOfSupply
      ?? observedMonthsSupply;
    const population = soldMetrics.population ?? activeMetrics.population ?? null;
    const populationDensity = soldMetrics.populationDensity ?? activeMetrics.populationDensity ?? null;
    const populationGrowth = soldMetrics.populationGrowth ?? activeMetrics.populationGrowth ?? null;
    const likelyResaleTime = medianDom != null
      ? `${Math.max(1, Math.round(medianDom / 30))}–${Math.max(2, Math.round(medianDom / 30) + 2)} months based on sold DOM`
      : monthsSupply != null
        ? `${Math.max(1, Math.ceil(monthsSupply))}–${Math.max(2, Math.ceil(monthsSupply) + 2)} months from current supply/absorption`
        : 'Insufficient sold DOM and absorption evidence';
    const movementScore = (sellThrough ?? 0) / 100 * 30
      + (absorptionRate != null
        ? Math.min(1, Math.max(0, absorptionRate) / 100) * 20
        : absorptionPerMonth != null ? Math.min(1, absorptionPerMonth / 0.5) * 20 : 0)
      + (monthsSupply != null ? Math.max(0, 1 - Math.min(monthsSupply, 36) / 36) * 15 : 0)
      + (medianDom != null ? Math.max(0, 1 - medianDom / 365) * 15 : 0)
      + Math.min(1, soldVolume / 12) * 15
      + (trend.direction === 'up' ? 5 : trend.direction === 'flat' ? 2.5 : 0);
    const sources = [internalSold, internalActive]
      .filter((snapshot): snapshot is InternalCountyAcreageSnapshot => snapshot != null);
    const confidenceOrder = { low: 1, medium: 2, high: 3 } as const;
    const confidence: AcreageBandMarketRead['confidence'] = sources.length
      ? sources.map((snapshot) => snapshot.confidence)
          .sort((a, b) => confidenceOrder[a] - confidenceOrder[b])[0]
      : sold.length + active.length > 0 ? 'low' : 'none';
    const periods = [...new Set(sources.map((snapshot) => snapshot.period))];
    const coverage = sources.length
      ? [...new Set(sources.map((snapshot) => snapshot.coverage))].join(' | ')
      : `${sold.length} sold and ${active.length} active selected observation(s); not a county Market Research snapshot.`;
    const source = sources.length
      ? [...new Set(sources.map((snapshot) => snapshot.provider))].join(', ')
      : 'Selected sold and active market observations';

    return {
      band: definition.band,
      soldVolume,
      activeInventory,
      medianSalePrice,
      medianPricePerAcre,
      medianDaysOnMarket: medianDom,
      sellThroughRate: sellThrough == null ? null : Math.round(sellThrough * 10) / 10,
      absorptionRate: absorptionRate == null ? null : Math.round(absorptionRate * 10) / 10,
      absorptionPerMonth: absorptionPerMonth == null ? null : Math.round(absorptionPerMonth * 100) / 100,
      monthsOfSupply: monthsSupply == null ? null : Math.round(monthsSupply * 10) / 10,
      population,
      populationDensity,
      populationGrowth,
      priceTrend: trend,
      likelyResaleTime,
      movementRank: null,
      snapshotPeriod: periods.length ? periods.join(' / ') : null,
      confidence,
      coverage,
      source,
      evidence: sources.length
        ? `${soldVolume} sold and ${activeInventory} active in the ${definition.band} acre internal county snapshot (${periods.join(' / ')}; ${confidence} confidence).`
        : `${sold.length} sold and ${active.length} active row(s) in the ${definition.band} acre band over ${lookbackMonths} months.`,
      movementScore,
    };
  });

  const ranked = bands.filter((band) => band.soldVolume + band.activeInventory > 0)
    .sort((a, b) => b.movementScore - a.movementScore);
  ranked.forEach((band, index) => { band.movementRank = index + 1; });
  const publicBands: AcreageBandMarketRead[] = bands.map(({ movementScore: _movementScore, ...band }) => band);
  const subjectBand = practicalAcreageBand(input.subjectAcres);
  const bulk = publicBands.find((band) => band.band === subjectBand) ?? null;
  const subjectIndex = subjectBand == null ? -1 : PRACTICAL_ACREAGE_BANDS.findIndex((entry) => entry.band === subjectBand);
  const smaller = subjectIndex < 0
    ? []
    : publicBands.slice(subjectIndex + 1).filter((band) => band.medianPricePerAcre != null);
  const bestSmaller = [...smaller].sort((a, b) => (b.medianPricePerAcre ?? 0) - (a.medianPricePerAcre ?? 0))[0] ?? null;
  const bulkPpa = bulk?.medianPricePerAcre ?? null;
  const smallerPpa = bestSmaller?.medianPricePerAcre ?? null;
  const premium = bulkPpa && smallerPpa ? ((smallerPpa - bulkPpa) / bulkPpa) * 100 : null;
  const arbitrageStatus = premium == null ? 'insufficient' : premium > 5 ? 'supported' : 'not_observed';

  return {
    lookbackMonths,
    bands: publicBands,
    subjectBand,
    bulkTractRead: bulk
      ? `${subjectBand} acre bulk-tract evidence: ${bulk.evidence} Median ${bulk.medianPricePerAcre == null ? '$/acre unavailable' : `$${Math.round(bulk.medianPricePerAcre).toLocaleString()}/acre`}; likely resale ${bulk.likelyResaleTime}.`
      : 'Subject acreage does not map to the 2+ acre matrix.',
    splitSizeRead: bestSmaller
      ? `${bestSmaller.band} acres is the strongest smaller-lot price band at $${Math.round(bestSmaller.medianPricePerAcre!).toLocaleString()}/acre; movement rank ${bestSmaller.movementRank ?? 'unavailable'}.`
      : 'No smaller acreage band has enough sold evidence to support split pricing.',
    arbitrage: {
      status: arbitrageStatus,
      bulkPricePerAcre: bulkPpa,
      bestSmallerBand: bestSmaller?.band ?? null,
      smallerBandPricePerAcre: smallerPpa,
      premiumPercent: premium == null ? null : Math.round(premium * 10) / 10,
      explanation: premium == null
        ? 'Bulk-versus-split per-acre arbitrage cannot be measured from the retained rows.'
        : premium > 5
          ? `${bestSmaller!.band} acre sales show a ${premium.toFixed(1)}% per-acre premium over the ${subjectBand} bulk band before subdivision costs.`
          : `No meaningful per-acre premium is observed after comparing ${bestSmaller!.band} acres with the ${subjectBand} bulk band.`,
    },
    bestMovingBands: ranked.slice(0, 3).map((band) => band.band),
  };
}

// ── The combined market scan (persisted per Deal Card by the route layer) ────

export interface MarketScanResult {
  area: { county?: string; state?: string; descriptor: string };
  dataCenterWatch: DataCenterWatch;
  growthSignals: MarketSignalScan;
  /** Sourced web evidence on the county's land market at the subject acreage. */
  landMarketWeb?: LandMarketWebRead;
  acreageMatrix?: PracticalMarketMatrix;
  generatedAt: string;
}

/** A search function the live route injects (Gemini-grounded or any future
 *  approved source). Returns findings or throws on hard failure. */
export type ScanSearchFn = (query: string) => Promise<ScanFinding[]>;

export const DATA_CENTER_QUERY = (area: string) =>
  `${area} data center OR "AI campus" OR hyperscale proposed OR approved OR "under construction" 2025 2026`;
/** One bounded corroboration query for a proposed / rumored data-center item. */
export const DATA_CENTER_CORROBORATION_QUERY = (area: string, subject: string): string =>
  `"${subject.slice(0, 90)}" ${area} data center proposal approved OR rejected OR hearing OR rezoning status`;
export const GROWTH_SIGNAL_QUERY = (area: string) =>
  `${area} population growth OR housing growth OR "new subdivision" OR "master planned" OR commercial development OR industrial project OR manufacturing plant OR "distribution center" OR road project OR transportation improvement OR "water line extension" OR "sewer extension" OR utility expansion OR annexation OR rezoning OR employer expansion OR employer closure OR "building permits" 2025 2026`;

/** Items whose existence is claimed rather than built — worth a second source. */
const CORROBORATE_STATUSES: ReadonlySet<DataCenterItemStatus> = new Set([
  'proposed', 'planning_activity', 'community_opposition', 'mention',
]);

/**
 * Run the live market scan with an injected search function. Bounded by
 * construction: three topic queries (data centers, growth signals, land market)
 * plus at most ONE corroboration query for a proposed/rumored data-center item —
 * never a runaway loop. Failure of one query degrades that lane honestly; it
 * never blocks the others.
 */
export async function runMarketScan(input: {
  county?: string;
  state?: string;
  /** Widen the geographic screen and the query with the subject's own locality. */
  city?: string;
  zip?: string;
  search: ScanSearchFn | null; // null = no search source configured
  marketObservations?: AcreageMarketObservation[];
  internalCountySnapshots?: InternalCountyAcreageSnapshot[];
  subjectAcres?: number | null;
  /** Set false to skip the bounded corroboration query (tests, tight budgets). */
  corroborate?: boolean;
  nowIso?: string;
}): Promise<MarketScanResult> {
  const descriptor = [input.county, input.state].filter(Boolean).join(', ') || 'this area';
  const generatedAt = input.nowIso ?? new Date().toISOString();
  const acreageFocus = acreageFocusLabel(input.subjectAcres);
  // The subject's own town is what local coverage actually names, so it is part
  // of the query as well as the screen.
  const queryArea = input.city ? `${input.city} ${descriptor}` : descriptor;
  const place = { county: input.county, state: input.state, city: input.city, zip: input.zip };
  const matrix = (): PracticalMarketMatrix | undefined =>
    (input.marketObservations || input.internalCountySnapshots
      ? buildPracticalMarketMatrix({
        observations: input.marketObservations ?? [],
        internalCountySnapshots: input.internalCountySnapshots,
        subjectAcres: input.subjectAcres,
        nowIso: generatedAt,
      })
      : undefined);

  if (!input.search || descriptor === 'this area') {
    return {
      area: { county: input.county, state: input.state, descriptor },
      dataCenterWatch: buildDataCenterWatch({ ...place, findings: null, nowIso: generatedAt }),
      growthSignals: buildMarketSignalScan({ ...place, findings: null, nowIso: generatedAt }),
      landMarketWeb: buildLandMarketWebRead({ ...place, acreageFocus, findings: null, nowIso: generatedAt }),
      acreageMatrix: matrix(),
      generatedAt,
    };
  }

  const search = input.search;
  const runQuery = async (query: string): Promise<{ findings: ScanFinding[] | null; failed: boolean }> => {
    try {
      return { findings: await search(query), failed: false };
    } catch {
      return { findings: null, failed: true };
    }
  };

  // The three topic lanes are independent questions about the same market, so
  // they run concurrently rather than making one lane wait on another's latency.
  const [dc, gs, lm] = await Promise.all([
    runQuery(DATA_CENTER_QUERY(queryArea)),
    runQuery(GROWTH_SIGNAL_QUERY(queryArea)),
    runQuery(LAND_MARKET_QUERY(queryArea, acreageFocus)),
  ]);

  const dataCenterWatch = buildDataCenterWatch({
    ...place, findings: dc.findings, searchFailed: dc.failed, nowIso: generatedAt,
  });

  // Corroborate the strongest proposed / rumored item against a second query.
  // Bounded to one: this is a corroboration pass, not an investigation.
  if ((input.corroborate ?? true) && dataCenterWatch.status === 'found') {
    const target = dataCenterWatch.items.find((item) => CORROBORATE_STATUSES.has(item.status));
    if (target) {
      const outcome = await runQuery(DATA_CENTER_CORROBORATION_QUERY(queryArea, target.title));
      const support = (outcome.findings ?? []).find((finding) =>
        DC_TOPIC.test(`${finding.title} ${finding.summary}`)
        && mentionsSubjectArea(`${finding.title} ${finding.summary}`, place)
        && (finding.url ?? '') !== (target.url ?? ''));
      target.corroboration = support
        ? { summary: `${(support.title || '').trim()} — ${(support.summary || '').trim()}`.trim(), url: (support.url && support.url.trim()) || null }
        : null;
      dataCenterWatch.verdict = `${dataCenterWatch.verdict ?? ''} ${target.corroboration
        ? `The ${target.status.replace(/_/g, ' ')} item "${target.title}" is corroborated by a second independent source.`
        : `The ${target.status.replace(/_/g, ' ')} item "${target.title}" could not be corroborated by a second source in this pass; it stays uncorroborated, not disproven.`}`.trim();
    }
  }

  return {
    area: { county: input.county, state: input.state, descriptor },
    dataCenterWatch,
    growthSignals: buildMarketSignalScan({ ...place, findings: gs.findings, searchFailed: gs.failed, nowIso: generatedAt }),
    landMarketWeb: buildLandMarketWebRead({ ...place, acreageFocus, findings: lm.findings, searchFailed: lm.failed, nowIso: generatedAt }),
    acreageMatrix: matrix(),
    generatedAt,
  };
}
