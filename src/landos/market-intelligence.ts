import type { DealCardReportView } from './deal-card-report.js';
import type { ComparableIntelligence, IntelligenceConfidence } from './comparable-intelligence.js';
import type { BrowserMarketIntelligence, GrowthDriverSummary, MarketEvidence } from './browser-market-intelligence.js';

export type MarketFactStatus = 'verified' | 'observed' | 'estimated' | 'unknown' | 'needs_verification';

export interface MarketIntelligenceFact {
  label: string;
  status: MarketFactStatus;
  value: string | null;
  confidence: IntelligenceConfidence;
  source: string | null;
  note: string;
}

export type MarketPulseSectionKey =
  | 'property_movement'
  | 'most_active_property_type'
  | 'population_direction'
  | 'major_development_activity'
  | 'infrastructure_expansion'
  | 'planning_and_government_activity'
  | 'restrictions_or_moratoriums'
  | 'deal_impact';

/** A concise owner-facing conclusion with only the supporting public sources
 * retained for that conclusion.  It is deliberately a report section, not a
 * raw news feed or research trace. */
export interface MarketPulseSection {
  key: MarketPulseSectionKey;
  heading: string;
  finding: string;
  sources: Array<{ label: string; url: string | null }>;
}

export interface MarketResearchInput {
  browserIntel?: BrowserMarketIntelligence | null;
  growthSummary?: GrowthDriverSummary | null;
}

export interface MarketIntelligence {
  capability: 'market_intelligence';
  label: string;
  confidence: IntelligenceConfidence;
  facts: MarketIntelligenceFact[];
  marketPulse: string;
  /** The concise, property-relevant Market Pulse shown in the owner brief. */
  sections: MarketPulseSection[];
  opportunities: string[];
  risks: string[];
  sources: Array<{ source: string; url?: string | null; status: string; note: string }>;
  missingInformation: string[];
}

const fmt = (n: number | null | undefined): string | null => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n).toLocaleString() : null);
const money = (n: number | null | undefined): string | null => {
  const v = fmt(n);
  return v == null ? null : `$${v}`;
};

function fact(input: MarketIntelligenceFact): MarketIntelligenceFact {
  return input;
}

function marketDirection(report: DealCardReportView): { value: string | null; confidence: IntelligenceConfidence; note: string } {
  const demographics = report.demographics as unknown as { status?: string; populationTrend?: string; growthPct?: number; summary?: string; note?: string };
  if (demographics?.populationTrend) {
    return { value: demographics.populationTrend, confidence: 'medium', note: demographics.summary ?? 'Population trend from connected demographic source.' };
  }
  return { value: null, confidence: 'low', note: 'Population trend source is not connected or did not return a trend.' };
}

function wordsForType(type: string): string {
  return type.replace(/_/g, ' ');
}

function range(values: number[], formatter: (value: number) => string): string | null {
  if (!values.length) return null;
  const low = Math.min(...values);
  const high = Math.max(...values);
  return low === high ? formatter(low) : `${formatter(low)}–${formatter(high)}`;
}

function evidenceFor(
  evidence: MarketEvidence[],
  predicate: (item: MarketEvidence) => boolean,
): Array<{ label: string; url: string | null }> {
  const seen = new Set<string>();
  return evidence.filter(predicate).flatMap((item) => {
    const label = `${item.source}: ${item.snippet}`.replace(/\s+/g, ' ').trim();
    const key = `${label}|${item.url}`;
    if (!label || seen.has(key)) return [];
    seen.add(key);
    return [{ label: label.slice(0, 220), url: item.url || null }];
  }).slice(0, 2);
}

function retainedEvidenceMessage(label: string): string {
  return `No material ${label.toLowerCase()} item is supported by the retained local sources for this property area.`;
}

function buildPulseSections(
  report: DealCardReportView,
  comps: ComparableIntelligence,
  input: MarketResearchInput,
  sold: number,
  active: number,
  absorptionMonths: number | null,
  direction: ReturnType<typeof marketDirection>,
): MarketPulseSection[] {
  const metrics = report.marketComps?.metrics;
  const areaTokens = (input.browserIntel?.area ?? '')
    .split(/[,\s]+/)
    .map((part) => part.replace(/county$/i, '').trim().toLowerCase())
    .filter((part) => part.length >= 4 && !/^(?:georgia|south|north|east|west)$/i.test(part));
  // A statewide headline is not a property-area catalyst.  The generic news
  // query can return adjacent or statewide stories, so retain an item only
  // when its actual headline/support text names the subject city or county.
  const evidence = (input.browserIntel?.status === 'collected' ? input.browserIntel.evidence : [])
    .filter((item) => areaTokens.some((token) => `${item.snippet} ${item.supports}`.toLowerCase().includes(token)));
  const soldRows = comps.comparables.filter((row) => row.status === 'sold');
  const typeCounts = new Map<string, number>();
  for (const row of soldRows) typeCounts.set(row.propertyType, (typeCounts.get(row.propertyType) ?? 0) + 1);
  const activeType = [...typeCounts.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
  const soldAcres = soldRows.flatMap((row) => row.acreage == null ? [] : [row.acreage]);
  const soldPrices = soldRows.flatMap((row) => row.salePrice == null ? [] : [row.salePrice]);
  const movement = sold > 0
    ? `${sold} retained closed sale${sold === 1 ? '' : 's'} and ${active} active listing${active === 1 ? '' : 's'} indicate that properties are moving.${metrics?.domMedian != null ? ` Typical exposure is about ${metrics.domMedian} days.` : ''}${absorptionMonths != null ? ` Supply reads at about ${absorptionMonths} months.` : ''}`
    : 'Retained market evidence does not yet establish closed-sale movement for this property area.';
  const typeFinding = activeType && activeType[0] !== 'unknown'
    ? `The returned closed-sale sample is led by ${wordsForType(activeType[0])} (${activeType[1]} sale${activeType[1] === 1 ? '' : 's'}). It spans ${range(soldAcres, (n) => `${n} acres`) ?? 'an unreported acreage range'} and ${range(soldPrices, (n) => `$${Math.round(n).toLocaleString()}`) ?? 'an unreported price range'}; this is observed local activity, not a claim about all buyer demand.`
    : 'The retained closed-sale sample is too thin or too loosely classified to name a property type, acreage band, or price band with confidence.';
  const population = direction.value
    ? `Population direction is ${/declin/i.test(direction.value) ? 'declining' : /grow|increase/i.test(direction.value) ? 'growing' : 'stable or mixed'} based on the connected demographic read: ${direction.value}.`
    : 'Population direction has not been measured from a retained demographic source for this property area.';
  const development = evidenceFor(evidence, (item) => ['development', 'employer', 'economic_development'].includes(item.sourceType) && /develop|employer|industrial|commercial|housing|subdivision|apartment|investment/i.test(`${item.snippet} ${item.supports}`));
  const infrastructure = evidenceFor(evidence, (item) => item.sourceType === 'infrastructure' && /(?:road|highway|interchange|water|sewer|utility|broadband|power|rail|transit).{0,55}(?:extend|extension|expand|expansion|widen|new|upgrade|improve|construct|project)|(?:extend|extension|expand|expansion|widen|new|upgrade|improve|construct|project).{0,55}(?:road|highway|interchange|water|sewer|utility|broadband|power|rail|transit)/i.test(`${item.snippet} ${item.supports}`));
  const planning = evidenceFor(evidence, (item) => ['county_planning', 'government'].includes(item.sourceType) && /plan|zoning|rezoning|annex|commission|council|board|vote|hearing|land.?use/i.test(`${item.snippet} ${item.supports}`));
  const restrictionRx = /moratorium|restriction|freeze|capacity|zoning denial|building limitation|annexation denial|utility constraint|sewer constraint|water.{0,30}(?:controversy|concern|issue)|drought/i;
  const restrictions = evidenceFor(evidence, (item) => restrictionRx.test(`${item.snippet} ${item.supports}`));
  const developmentFinding = development.length
    ? `Material development or employer activity retained for this area: ${development.map((item) => item.label.replace(/^[^:]+:\s*/, '')).join('; ')}.`
    : retainedEvidenceMessage('development or employer');
  const infrastructureFinding = infrastructure.length
    ? `Infrastructure signal${infrastructure.length === 1 ? '' : 's'} retained for this area: ${infrastructure.map((item) => item.label.replace(/^[^:]+:\s*/, '')).join('; ')}.`
    : retainedEvidenceMessage('infrastructure-expansion');
  const planningFinding = planning.length
    ? `Planning or government item${planning.length === 1 ? '' : 's'} retained for this area: ${planning.map((item) => item.label.replace(/^[^:]+:\s*/, '')).join('; ')}.`
    : retainedEvidenceMessage('planning or government');
  const restrictionFinding = restrictions.length
    ? `Potential restriction or capacity item${restrictions.length === 1 ? '' : 's'} to verify before underwriting: ${restrictions.map((item) => item.label.replace(/^[^:]+:\s*/, '')).join('; ')}.`
    : retainedEvidenceMessage('moratorium, development restriction, or utility-capacity');
  const catalysts = [development.length > 0, infrastructure.length > 0, planning.length > 0].filter(Boolean).length;
  const dealImpact = `${sold > 0 ? 'Observed sale activity supports a resale audience' : 'Thin closed-sale evidence weakens resale certainty'}${direction.value && /declin/i.test(direction.value) ? ', while population direction is a caution' : ''}${catalysts ? `; ${catalysts === 1 ? 'one' : `${catalysts}`} retained growth/planning signal${catalysts === 1 ? '' : 's'} may support demand if confirmed for the parcel` : ''}. ${restrictions.length ? 'Do not underwrite the cited restriction/capacity item as resolved.' : 'No retained material restriction item changes the preliminary view, but parcel-specific zoning and utilities still require confirmation.'}`;

  return [
    { key: 'property_movement', heading: 'Property Movement', finding: movement, sources: report.marketComps?.source ? [{ label: report.marketComps.source, url: null }] : [] },
    { key: 'most_active_property_type', heading: 'Most Active Property Type', finding: typeFinding, sources: soldRows.slice(0, 2).flatMap((row) => row.sourceUrl ? [{ label: row.source, url: row.sourceUrl }] : []) },
    { key: 'population_direction', heading: 'Population Direction', finding: population, sources: direction.value ? [{ label: 'Connected demographics source', url: null }] : [] },
    { key: 'major_development_activity', heading: 'Major Development Activity', finding: developmentFinding, sources: development },
    { key: 'infrastructure_expansion', heading: 'Infrastructure Expansion', finding: infrastructureFinding, sources: infrastructure },
    { key: 'planning_and_government_activity', heading: 'Planning and Government Activity', finding: planningFinding, sources: planning },
    { key: 'restrictions_or_moratoriums', heading: 'Restrictions or Moratoriums', finding: restrictionFinding, sources: restrictions },
    { key: 'deal_impact', heading: 'Deal Impact', finding: dealImpact, sources: [...development, ...infrastructure, ...planning, ...restrictions].slice(0, 3) },
  ];
}

export function buildMarketIntelligence(report: DealCardReportView, comps: ComparableIntelligence, input: MarketResearchInput = {}): MarketIntelligence {
  const mc = report.marketComps;
  const metrics = mc?.metrics;
  const sold = mc?.soldCount ?? comps.selectedComparables.filter((c) => c.status === 'sold').length;
  const active = mc?.activeCount ?? comps.comparables.filter((c) => c.status === 'active').length;
  const usingAskingFallback = sold === 0 && comps.selectedComparables.some((c) => c.status === 'active' || c.status === 'listed' || c.status === 'pending');
  const monthlySold = sold > 0 ? sold / 12 : null;
  const absorptionMonths = monthlySold && active > 0 ? Math.round((active / monthlySold) * 10) / 10 : null;
  const sellThrough = sold + active > 0 ? Math.round((sold / (sold + active)) * 100) : null;
  const direction = marketDirection(report);
  const hasPrice = comps.estimatedPricePerAcre.mid != null || metrics?.soldMedianPpa != null;
  const confidence: IntelligenceConfidence =
    usingAskingFallback ? 'low'
      : sold >= 5 && hasPrice ? 'high'
        : sold >= 2 || hasPrice ? 'medium'
        : 'low';
  const label = report.parcelVerified ? 'Parcel Verified Market Intelligence' : 'Local Area Market Intelligence, Not Parcel Verified';

  const facts: MarketIntelligenceFact[] = [
    fact({
      label: 'Population trend',
      status: direction.value ? 'verified' : 'unknown',
      value: direction.value,
      confidence: direction.confidence,
      source: direction.value ? 'Demographics source' : null,
      note: direction.note,
    }),
    fact({
      label: 'Growth direction',
      status: direction.value ? 'estimated' : 'unknown',
      value: direction.value ? (/declin/i.test(direction.value) ? 'Declining' : /grow|increase/i.test(direction.value) ? 'Growing' : 'Stable / mixed') : null,
      confidence: direction.confidence,
      source: direction.value ? 'Demographics source' : null,
      note: 'Interpreted from available population trend evidence; verify with current county/city planning sources.',
    }),
    fact({
      label: 'County average price per acre',
      status: metrics?.soldMedianPpa != null ? 'estimated' : 'unknown',
      value: money(metrics?.soldMedianPpa),
      confidence: metrics?.soldMedianPpa != null ? confidence : 'low',
      source: mc?.source ?? null,
      note: metrics?.soldMedianPpa != null ? 'Area sold land median from connected comparable providers.' : 'No county/local sold land price-per-acre metric connected.',
    }),
    fact({
      label: 'Local average price per acre',
      status: comps.estimatedPricePerAcre.mid != null ? 'estimated' : 'unknown',
      value: money(comps.estimatedPricePerAcre.mid),
      confidence: comps.confidence,
      source: comps.evidenceUsed.join('; ') || null,
      note: usingAskingFallback
        ? 'Estimated from selected asking/listed comparables because sold comps were not available. Not final underwriting.'
        : 'Estimated from selected sold comparables. Not final underwriting.',
    }),
    fact({
      label: 'Sell-through rate',
      status: sellThrough != null ? 'estimated' : 'unknown',
      value: sellThrough != null ? `${sellThrough}%` : null,
      confidence: sellThrough != null ? confidence : 'low',
      source: mc?.source ?? null,
      note: 'Sold count divided by sold plus active listing count. Market proxy only.',
    }),
    fact({
      label: 'Absorption rate',
      status: absorptionMonths != null ? 'estimated' : 'unknown',
      value: absorptionMonths != null ? `${absorptionMonths} months of inventory` : null,
      confidence: absorptionMonths != null ? confidence : 'low',
      source: mc?.source ?? null,
      note: 'Active listings divided by a 12-month sold-rate proxy.',
    }),
    fact({
      label: 'Days on Market',
      status: metrics?.domMedian != null ? 'estimated' : 'unknown',
      value: metrics?.domMedian != null ? `${metrics.domMedian} days` : null,
      confidence: metrics?.domMedian != null ? confidence : 'low',
      source: mc?.source ?? null,
      note: metrics?.domMedian != null ? 'Median days-on-market from connected comparable providers.' : 'Days-on-market not established.',
    }),
    fact({
      label: 'Active listings',
      status: active > 0 ? 'observed' : 'unknown',
      value: active > 0 ? String(active) : null,
      confidence: active > 0 ? 'medium' : 'low',
      source: mc?.source ?? null,
      note: 'Active listings are asking-market context, not sold evidence.',
    }),
    fact({
      label: 'Sold listings',
      status: sold > 0 ? 'observed' : 'unknown',
      value: sold > 0 ? String(sold) : null,
      confidence: sold > 0 ? confidence : 'low',
      source: mc?.source ?? null,
      note: 'Sold listings drive the strongest current market-value evidence.',
    }),
    fact({
      label: 'Sales density',
      status: sold > 0 ? 'estimated' : 'unknown',
      value: sold >= 6 ? 'Healthy' : sold >= 2 ? 'Thin' : sold === 1 ? 'Very thin' : null,
      confidence: sold >= 2 ? 'medium' : 'low',
      source: mc?.source ?? null,
      note: 'Proxy from retrieved sold land count; radius and provider coverage affect this.',
    }),
    fact({
      label: 'County comprehensive plan',
      status: 'needs_verification',
      value: null,
      confidence: 'low',
      source: null,
      note: 'Needs official county/city comprehensive plan source.',
    }),
    fact({
      label: 'Growth plans / infrastructure / developments / employers / tourism / utilities / road projects',
      status: 'needs_verification',
      value: null,
      confidence: 'low',
      source: null,
      note: 'Needs official planning, DOT, utility, economic-development, and local news sources before being treated as verified.',
    }),
  ];

  const ppa = money(comps.estimatedPricePerAcre.mid ?? metrics?.soldMedianPpa);
  const liquidity = absorptionMonths != null
    ? absorptionMonths < 6 ? 'tight supply' : absorptionMonths <= 12 ? 'balanced supply' : 'soft supply'
    : 'unclear absorption';
  const marketPulse = ppa
    ? usingAskingFallback
      ? `Land in this market is currently reading around ${ppa}/acre from the best available asking/listed land evidence. ${sold} sold and ${active} active listing(s) suggest ${liquidity}. This matters because resale confidence is weaker without recent sold evidence, so Tyler should frame value as a low-confidence market read.`
      : `Land in this market is currently reading around ${ppa}/acre from the best available sold comparable evidence. ${sold} sold and ${active} active listing(s) suggest ${liquidity}. This matters because resale confidence depends on a real buyer pool and recent sold evidence, not ZIP boundaries.`
    : `Market price evidence is still thin. ${sold} sold and ${active} active listing(s) were available, but the current data does not establish a reliable price-per-acre band.`;
  const sections = buildPulseSections(report, comps, input, sold, active, absorptionMonths, direction);

  const opportunities = [
    sold > 0 ? 'Recent sold land evidence exists, so Tyler can anchor the discovery call around market-supported expectations.' : '',
    active > 0 ? 'Active listings show current resale competition and asking-market context.' : '',
    comps.subjectClassification.type === 'vacant_land' ? 'Vacant-land classification supports land-specific comparable selection.' : '',
    comps.acreageBand ? `Subject acreage band ${comps.acreageBand} supports tighter comp selection.` : '',
  ].filter(Boolean);
  const risks = [
    comps.evidenceMissing.length ? `Comparable evidence gaps: ${comps.evidenceMissing.join(', ')}.` : '',
    !report.parcelVerified ? 'Parcel is not verified; market read is local-area context only.' : '',
    absorptionMonths != null && absorptionMonths > 12 ? 'Absorption appears soft; resale may take longer.' : '',
    comps.subjectClassification.confidence === 'low' ? 'Subject property type is weakly classified; wrong type filters can distort value.' : '',
  ].filter(Boolean);
  const sources = [
    ...(mc?.providers ?? []).map((p) => ({ source: p.providerId, status: p.status, note: `${p.kept} comparable row(s) kept.` })),
    ...(report.sourceTable ?? []).map((s) => ({ source: s.source, status: s.status, note: s.detail })),
  ];
  const missingInformation = facts.filter((f) => f.status === 'unknown' || f.status === 'needs_verification').map((f) => f.label);

  return { capability: 'market_intelligence', label, confidence, facts, marketPulse, sections, opportunities, risks, sources, missingInformation };
}
