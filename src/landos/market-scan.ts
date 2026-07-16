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
  | 'manufacturing'
  | 'distribution'
  | 'water_expansion'
  | 'sewer_expansion'
  | 'highway_project'
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
  status: DataCenterItemStatus;
  summary: string;
  whyItMatters: string;
  url: string | null;
  year: number | null;
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

/**
 * Build the Data Center Watch from search findings. PURE. Keeps only 2025+
 * (or undated) findings that are actually about data-center / AI-compute
 * activity; classifies each; never fabricates: no findings in → none_found,
 * no search run → not_run.
 */
export function buildDataCenterWatch(input: {
  county?: string;
  state?: string;
  findings: ScanFinding[] | null; // null = the search did not run
  searchFailed?: boolean;
  nowIso?: string;
}): DataCenterWatch {
  const area = [input.county, input.state].filter(Boolean).join(', ') || 'this area';
  const generatedAt = input.nowIso ?? new Date().toISOString();
  const note = 'Existence check only (2025+). If this matters to the deal, queue deeper Jarvis research — this scan does not investigate.';

  if (input.searchFailed) {
    return { status: 'unavailable', area, items: [], summary: `Data Center Watch could not complete for ${area} — the search source was unavailable.`, whyItMatters: '', note, generatedAt };
  }
  if (input.findings == null) {
    return { status: 'not_run', area, items: [], summary: `Data Center Watch has not run for ${area} yet.`, whyItMatters: '', note, generatedAt };
  }

  const items: DataCenterWatchItem[] = [];
  for (const f of input.findings) {
    const text = `${f.title} ${f.summary}`;
    if (!DC_TOPIC.test(text)) continue;                       // not data-center activity
    if (f.year != null && f.year < 2025) continue;            // 2025+ only
    const status = classifyDataCenterStatus(text);
    items.push({
      title: (f.title || '').trim() || 'Data center activity',
      status,
      summary: (f.summary || '').trim(),
      whyItMatters: DC_WHY[status],
      url: (f.url && f.url.trim()) || null,
      year: f.year ?? null,
    });
  }

  if (!items.length) {
    return {
      status: 'none_found', area, items: [],
      summary: `No 2025+ data-center or AI-campus activity found for ${area}. That is a real answer, not a gap — this market shows no institutional compute demand signal right now.`,
      whyItMatters: '', note, generatedAt,
    };
  }

  const strongest = items.find((i) => i.status === 'under_construction') ?? items.find((i) => i.status === 'approved') ?? items[0];
  const statuses = Array.from(new Set(items.map((i) => i.status.replace(/_/g, ' '))));
  return {
    status: 'found', area, items: items.slice(0, 6),
    summary: `Data-center / AI-campus activity found near ${area}: ${items.length} signal(s) — ${statuses.join(', ')}. Strongest: ${strongest.title}.`,
    whyItMatters: strongest.whyItMatters,
    note, generatedAt,
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
  const items: MarketSignalItem[] = [];
  let dropped = 0;
  for (const f of input.findings) {
    const text = `${f.title} ${f.summary}`;
    const rel = assessLandRelevance(text);
    if (!rel.relevant || !rel.category || !rel.whyItMatters) { dropped += 1; continue; }
    items.push({
      title: (f.title || '').trim() || 'Market signal',
      summary: (f.summary || '').trim(),
      category: rel.category,
      whyItMatters: rel.whyItMatters,
      url: (f.url && f.url.trim()) || null,
      year: f.year ?? null,
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

// ── The combined market scan (persisted per Deal Card by the route layer) ────

export interface MarketScanResult {
  area: { county?: string; state?: string; descriptor: string };
  dataCenterWatch: DataCenterWatch;
  growthSignals: MarketSignalScan;
  generatedAt: string;
}

/** A search function the live route injects (Gemini-grounded or any future
 *  approved source). Returns findings or throws on hard failure. */
export type ScanSearchFn = (query: string) => Promise<ScanFinding[]>;

export const DATA_CENTER_QUERY = (area: string) =>
  `${area} data center OR "AI campus" OR hyperscale proposed OR approved OR "under construction" 2025 2026`;
export const GROWTH_SIGNAL_QUERY = (area: string) =>
  `${area} population growth OR "new subdivision" OR "master planned" OR manufacturing plant OR "distribution center" OR "water line extension" OR "sewer extension" OR highway project OR rezoning OR "building permits" 2025 2026`;

/**
 * Run the live market scan with an injected search function. Exactly two bounded
 * queries (one per scan) — never a runaway loop. Failure of one query degrades
 * that scan honestly; it never blocks the other.
 */
export async function runMarketScan(input: {
  county?: string;
  state?: string;
  search: ScanSearchFn | null; // null = no search source configured
  nowIso?: string;
}): Promise<MarketScanResult> {
  const descriptor = [input.county, input.state].filter(Boolean).join(', ') || 'this area';
  const generatedAt = input.nowIso ?? new Date().toISOString();

  if (!input.search || descriptor === 'this area') {
    return {
      area: { county: input.county, state: input.state, descriptor },
      dataCenterWatch: buildDataCenterWatch({ county: input.county, state: input.state, findings: null, nowIso: generatedAt }),
      growthSignals: buildMarketSignalScan({ county: input.county, state: input.state, findings: null, nowIso: generatedAt }),
      generatedAt,
    };
  }

  let dcFindings: ScanFinding[] | null = null;
  let dcFailed = false;
  try {
    dcFindings = await input.search(DATA_CENTER_QUERY(descriptor));
  } catch {
    dcFailed = true;
  }
  let gsFindings: ScanFinding[] | null = null;
  let gsFailed = false;
  try {
    gsFindings = await input.search(GROWTH_SIGNAL_QUERY(descriptor));
  } catch {
    gsFailed = true;
  }

  return {
    area: { county: input.county, state: input.state, descriptor },
    dataCenterWatch: buildDataCenterWatch({ county: input.county, state: input.state, findings: dcFindings, searchFailed: dcFailed, nowIso: generatedAt }),
    growthSignals: buildMarketSignalScan({ county: input.county, state: input.state, findings: gsFindings, searchFailed: gsFailed, nowIso: generatedAt }),
    generatedAt,
  };
}
