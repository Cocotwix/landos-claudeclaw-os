import type { DealCardReportView } from './deal-card-report.js';
import type { ComparableIntelligence, IntelligenceConfidence } from './comparable-intelligence.js';

export type MarketFactStatus = 'verified' | 'observed' | 'estimated' | 'unknown' | 'needs_verification';

export interface MarketIntelligenceFact {
  label: string;
  status: MarketFactStatus;
  value: string | null;
  confidence: IntelligenceConfidence;
  source: string | null;
  note: string;
}

export interface MarketIntelligence {
  capability: 'market_intelligence';
  label: string;
  confidence: IntelligenceConfidence;
  facts: MarketIntelligenceFact[];
  marketPulse: string;
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

export function buildMarketIntelligence(report: DealCardReportView, comps: ComparableIntelligence): MarketIntelligence {
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

  return { capability: 'market_intelligence', label, confidence, facts, marketPulse, opportunities, risks, sources, missingInformation };
}
