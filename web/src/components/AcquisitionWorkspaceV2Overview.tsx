import {
  ExternalLink, ArrowUpRight, ShieldCheck, AlertTriangle, Target,
  FileCheck2, UserRound, MapPin, Ruler, Waves, Mountain,
  Droplets, CheckCircle2, CircleDot,
} from 'lucide-preact';

import type {
  AccessPresentationView,
  ExactAddressListingsView,
  MarketContextView,
  PiDdItem,
  PiEvidenceItem,
  PiFact,
  ResearchStatusView,
  SoilsSepticView,
  VisualBuyerNarrativeView,
} from './AcquisitionWorkspaceV2PropertyIntelligence';
import type { CompsValuationViewData } from './AcquisitionWorkspaceV2CompsValuation';
import '../styles/workspace-v2-overview.css';

export interface OverviewScoreView {
  score: number | null;
  rating: string;
  explanation?: string;
  strongestPositiveFactors?: string[];
  mainDeductions?: string[];
  materiallyChangeWith?: string[];
}

interface CanonicalOverviewState {
  decisionSummary?: string;
  blockers?: string[];
  missingInformation?: string[];
  nextActions?: string[];
}

export interface OverviewSnapshotView {
  identity?: {
    displayAddress?: string;
    normalizedAddress?: string;
    owner?: string | null;
    county?: string;
    state_?: string;
    apn?: string;
    acres?: number | null;
    lpPropertyId?: string | null;
    hasParcelGeometry?: boolean;
  };
  facts?: PiFact[];
  dueDiligence?: PiDdItem[];
  evidence?: PiEvidenceItem[];
  subjectParcelUrl?: string | null;
  operatorAnalysis?: {
    scores?: { property?: OverviewScoreView; market?: OverviewScoreView; seller?: OverviewScoreView };
    canonical?: CanonicalOverviewState | null;
    overall?: {
      recommendation?: string;
      mainOpportunity?: string;
      mainRisks?: string[];
      unansweredQuestions?: string[];
      nextBestActions?: string[];
    };
    methodology?: { assumptions?: string[]; notes?: string[] } | null;
  };
}

type ResearchStatusDetail = ResearchStatusView & {
  questionsResolved?: number;
  questionsTotal?: number;
  questionsHeadline?: string;
  /** Reconciled open diligence questions. The API sends objects; a plain
   *  string is accepted for older projections. */
  openQuestions?: Array<string | { label?: string; reason?: string; nextAction?: string }>;
};

interface OverviewSectionProps {
  snap: OverviewSnapshotView;
  address: string;
  zip: string;
  heroSrc: string | null;
  visualCount: number;
  seller: { name?: string; phone?: string; email?: string } | null;
  askingPrice: number | null;
  researchStatus: ResearchStatusView | null;
  accessView: AccessPresentationView | null;
  soilsSeptic: SoilsSepticView | null;
  narrative: VisualBuyerNarrativeView | null;
  visualBuyerSummary: { physicalCharacter?: string; mainBuyerAppeal?: string; topConcern?: string } | null;
  visualBuyerSummaryLabel: string;
  visualBuyerAnalysisLabel: string;
  onOpenVisualBuyerAnalysis: (event: MouseEvent) => void;
  exactAddressListings: ExactAddressListingsView | null;
  market: MarketContextView | null;
  compsValuation: CompsValuationViewData | null;
  valuationBasisLabel: string | null;
  landBasisOpeningReference: string | null;
  openCompsValuationLabel: string;
  openCompsValuation: () => void;
  acquisitionNextAction: { label?: string; reason?: string } | null;
  onOpenSection: (slug: 'property-intelligence' | 'comps-valuation') => void;
  formatUsd: (value: number) => string;
}

const unique = (items: Array<string | null | undefined>) => Array.from(new Set(items.filter((item): item is string => !!item?.trim())));

const numberIn = (value: string | null | undefined, pattern: RegExp): number | null => {
  const match = value?.match(pattern)?.[1];
  if (match == null) return null;
  const parsed = Number(match.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
};

const structureLabel = (type: string | null | undefined, improved: boolean): string => {
  if (!improved) return type === 'unknown' ? 'Structure pending' : 'Vacant Land';
  if (type === 'existing_residence' || /resid|dwelling|single.family|house/i.test(type ?? '')) return 'House';
  if (type === 'manufactured_home' || /manufactured|mobile home/i.test(type ?? '')) return 'Manufactured Home';
  if (!type || type === 'unknown') return 'Improved Property';
  return type.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
};

function ScoreCard({ view }: { view?: OverviewScoreView }) {
  const score = view?.score ?? null;
  const tone = score == null ? 'pending' : score < 50 ? 'weak' : score < 70 ? 'moderate' : 'strong';
  return (
    <section class="awv2-overview-score" aria-label="Property score">
      <div class="awv2-overview-score-number">
        <span class={tone}>{score ?? 'Pending'}</span>
        <small>{score == null ? 'Property score' : `${view?.rating || 'Unrated'} property score`}</small>
      </div>
      <div class="awv2-overview-score-drivers">
        <div><b>Positives</b>{(view?.strongestPositiveFactors?.length ? view.strongestPositiveFactors : ['No positive driver retained yet']).slice(0, 2).map((item) => <span class="positive">+ {item}</span>)}</div>
        <div><b>Risks</b>{(view?.mainDeductions?.length ? view.mainDeductions : ['No scored negative driver retained']).slice(0, 2).map((item) => <span class="negative">− {item}</span>)}</div>
        <div><b>Could change</b>{(view?.materiallyChangeWith?.length ? view.materiallyChangeWith : ['No additional score driver retained']).slice(0, 2).map((item) => <span>· {item}</span>)}</div>
      </div>
      {view?.explanation && <details class="awv2-overview-details"><summary>Score detail</summary><p>{view.explanation}</p></details>}
    </section>
  );
}

export function OverviewSection({
  snap,
  address,
  zip,
  heroSrc,
  visualCount,
  seller,
  askingPrice,
  researchStatus,
  accessView,
  soilsSeptic,
  narrative,
  visualBuyerSummary,
  visualBuyerSummaryLabel,
  visualBuyerAnalysisLabel,
  onOpenVisualBuyerAnalysis,
  exactAddressListings,
  market,
  compsValuation,
  valuationBasisLabel,
  landBasisOpeningReference,
  openCompsValuationLabel,
  openCompsValuation,
  acquisitionNextAction,
  onOpenSection,
  formatUsd,
}: OverviewSectionProps) {
  const identity = snap.identity ?? {};
  const operator = snap.operatorAnalysis;
  const canonical = operator?.canonical ?? null;
  const overall = operator?.overall;
  const improvement = compsValuation?.subjectImprovement ?? null;
  const summary = compsValuation?.summary;
  const cvSummary = summary ?? null;
  const usd = formatUsd;
  const status = researchStatus as ResearchStatusDetail | null;

  // Overview never derives a second comp count or valuation requirement. The
  // Comps & Valuation projection is the single authority for both. Server
  // decision prose can bake in the comp count that existed when the snapshot
  // was written; the live accepted count always wins over that prose.
  const decisionSummaryRaw = canonical?.decisionSummary || overall?.recommendation || overall?.mainOpportunity || 'Current decision summary is pending accepted research.';
  const decisionSummary = cvSummary
    ? decisionSummaryRaw.replace(/\d+\s+accepted closed sale\(s\)/g, `${cvSummary.acceptedCount} accepted closed sale(s)`)
    : decisionSummaryRaw;
  const firstDecisionStop = decisionSummary.search(/[.!?](?:\s|$)/);
  const decisionHeadline = firstDecisionStop >= 0
    ? decisionSummary.slice(0, firstDecisionStop + 1)
    : decisionSummary;
  const risks = unique(canonical?.blockers?.length ? canonical.blockers : overall?.mainRisks ?? []);
  const unresolved = unique(canonical?.missingInformation?.length ? canonical.missingInformation : overall?.unansweredQuestions ?? []);
  const canonicalActions = unique(canonical?.nextActions?.length ? canonical.nextActions : overall?.nextBestActions ?? []);
  const nextActions = unique([
    acquisitionNextAction?.label ? `${acquisitionNextAction.label}${acquisitionNextAction.reason ? ` — ${acquisitionNextAction.reason}` : ''}` : null,
    ...canonicalActions,
  ]);
  const marketRecord = [market?.subjectBand, market?.zip, market?.county]
    .find((record) => record?.available && record.metrics) ?? null;
  const marketMetrics = marketRecord?.metrics ?? null;
  const marketTiles = [
    marketMetrics?.sellThroughRate != null ? { label: 'Sell-through', value: `${marketMetrics.sellThroughRate}%`, kind: 'rate' } : null,
    marketMetrics?.medianDaysOnMarket != null ? { label: 'Median DOM', value: `${Math.round(marketMetrics.medianDaysOnMarket)}d`, kind: 'time' } : null,
    marketMetrics?.activeCount != null ? { label: 'Active supply', value: String(marketMetrics.activeCount), kind: 'supply' } : null,
    marketMetrics?.monthsOfSupply != null ? { label: 'Months supply', value: `${marketMetrics.monthsOfSupply} mo`, kind: 'supply' } : null,
    marketMetrics?.medianPricePerAcre != null ? { label: 'Median $/acre', value: usd(marketMetrics.medianPricePerAcre), kind: 'price' } : null,
  ].filter((tile): tile is { label: string; value: string; kind: string } => tile != null);

  // The reconciled subject decides whether a public listing exists. Overview no
  // longer re-derives it from whichever retained source sorted first, which is
  // how an actively listed subject was reported as having no listing at all.
  const listing = exactAddressListings?.listingCard ?? null;
  const openListingEvidence = () => {
    onOpenSection('property-intelligence');
    requestAnimationFrame(() => document.getElementById('exact-address-listing-evidence')?.scrollIntoView({ behavior: 'smooth' }));
  };

  // Access presentation rule: when the accepted parcel evidence says the
  // parcel is NOT flagged landlocked and it fronts a road (mapped frontage),
  // access is ESTABLISHED and displays as such — no speculative legal-access
  // warning is added. Warnings return only on actual contrary evidence
  // (a landlocked flag). The evidence ladder stays available as provenance.
  const accessEstablished = !!accessView?.established && !accessView?.evidence?.parcelFlagged;
  const accessTiers = [
    {
      label: 'Parcel / landlocked flag',
      state: accessView?.evidence?.parcelFlagged ? 'Flagged landlocked' : accessEstablished ? 'Not landlocked — fronts a recognized road' : accessView?.evidence ? 'Not flagged landlocked' : 'Not resolved',
      tone: accessView?.evidence?.parcelFlagged ? 'risk' : accessEstablished ? 'verified' : 'neutral',
      detail: accessView?.evidence?.byTier.parcel_flag?.[0]?.statement,
    },
    {
      label: 'Apparent physical access',
      state: accessView?.evidence?.apparentPhysicalAccess ? 'Apparent route observed' : accessEstablished && (accessView?.frontageFt ?? 0) > 0 ? `${accessView!.frontageFt} ft mapped road frontage` : 'Not established',
      tone: accessView?.evidence?.apparentPhysicalAccess || (accessEstablished && (accessView?.frontageFt ?? 0) > 0) ? 'observed' : 'neutral',
      detail: accessView?.evidence?.byTier.apparent_physical?.[0]?.statement,
    },
    {
      label: 'Reported legal / easement access',
      state: accessView?.evidence?.reportedLegalAccess ? 'Reported' : accessEstablished ? 'Direct frontage — no separate easement required at discovery stage' : 'Not reported',
      tone: accessView?.evidence?.reportedLegalAccess ? 'reported' : 'neutral',
      detail: accessView?.evidence?.byTier.reported_legal?.[0]?.statement,
    },
    {
      label: 'Verified recorded legal access',
      state: accessView?.evidence?.verifiedLegalAccess ? 'Verified' : accessEstablished ? 'Ordinary closing diligence' : 'Not verified',
      tone: accessView?.evidence?.verifiedLegalAccess ? 'verified' : accessEstablished ? 'neutral' : 'risk',
      detail: accessView?.evidence?.byTier.verified_legal?.[0]?.statement,
    },
  ];
  const accessConclusion = accessEstablished
    ? `${accessView?.legalAccess ?? 'Yes'}${accessView?.frontageFt != null ? ` — ${accessView.frontageFt} ft mapped road frontage` : ''}; not flagged landlocked.`
    : accessView?.evidence?.operatorConclusion
      ?? 'Physical and legal access evidence remains unresolved; zoning, septic and utilities still need confirmation.';

  const methodology = unique([...(operator?.methodology?.assumptions ?? []), ...(operator?.methodology?.notes ?? [])]);

  // ── Valuation display rules ────────────────────────────────────────────
  // "House Value" is the only name for the structure's worth. A residential subject over one
  // acre shows Land Value + House Value + Whole Property Value; at one acre
  // or less it shows a single property value with no breakdown. A house value
  // the backend has not established renders as Pending — never fabricated.
  const improvementValuation = compsValuation?.improvementValuation ?? null;
  const acresForValuation = cvSummary?.workingAcres ?? identity.acres ?? null;
  const residentialSubject = !!improvement?.improved && /resid|house|dwelling|home/i.test(improvement.type ?? '');
  const showHouseBreakdown = residentialSubject && (acresForValuation ?? 0) > 1;
  const singleResidentialValue = residentialSubject && acresForValuation != null && acresForValuation <= 1;
  const houseValue = improvementValuation?.estimatedSubjectImprovementValue ?? null;
  const wholePropertyValue = improvementValuation?.wholePropertyValue ?? null;

  // Overview and Property & Market both read the retained snapshot. These are
  // presentation-only projections of that canonical record; no property name,
  // deal id or proof-property special case participates in the design.
  const factValue = (...keys: string[]): string | null => snap.facts?.find((item) => keys.includes(item.key))?.value ?? null;
  const diligence = new Map((snap.dueDiligence ?? []).map((item) => [item.key, item]));
  const slopeRaw = factValue('lp_sidebar_slope', 'lp_sidebar_average_slope', 'lp_sidebar_slope_description')
    ?? diligence.get('terrain')?.headline ?? null;
  const buildabilityRaw = factValue('lp_sidebar_buildability', 'lp_sidebar_buildable_area', 'lp_sidebar_buildability_pct')
    ?? diligence.get('terrain')?.headline ?? null;
  const wetlandsRaw = factValue('lp_sidebar_wetlands', 'lp_sidebar_wetlands_pct', 'lp_sidebar_wetland_type')
    ?? diligence.get('wetlands')?.headline ?? null;
  const femaRaw = factValue('lp_sidebar_fema_flood_zone_description', 'lp_sidebar_fema_flood_pct', 'lp_sidebar_flood_zone')
    ?? diligence.get('flood')?.headline ?? null;
  const waterFeature = factValue('lp_sidebar_water_feature_type', 'lp_sidebar_water_feature', 'lp_sidebar_water_features');
  const slopePct = numberIn(slopeRaw, /([\d.]+)\s*%\s*average slope/i)
    ?? numberIn(slopeRaw, /([\d.]+)\s*%/);
  const buildabilityPct = numberIn(buildabilityRaw, /([\d.]+)\s*%\s*buildability/i)
    ?? numberIn(buildabilityRaw, /([\d.]+)\s*%/);
  const wetlandsPct = numberIn(wetlandsRaw, /([\d.]+)\s*%/);
  const femaPct = /not in (?:a )?flood hazard area|no (?:mapped )?flood/i.test(femaRaw ?? '')
    ? 0
    : numberIn(femaRaw, /([\d.]+)\s*%/);
  const affectedAcres = (pct: number | null, raw: string | null): number | null => (
    numberIn(raw, /([\d,.]+)\s*(?:acres?|ac)\b/i)
      ?? (pct != null && identity.acres != null ? identity.acres * pct / 100 : null)
  );
  const acreageText = (value: number | null): string | null => value == null
    ? null
    : `${value.toLocaleString('en-US', { maximumFractionDigits: 2 })} ac`;
  const pctText = (value: number | null, fallback: string | null): string => value == null
    ? fallback || 'Not retained'
    : `${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}%`;
  const subjectStructure = structureLabel(improvement?.type, !!improvement?.improved);
  const subjectHeading = `${subjectStructure}${identity.acres != null ? ` • ${identity.acres.toLocaleString('en-US', { maximumFractionDigits: 2 })} AC` : ''}`;

  const questionCards = (status?.openQuestions ?? []).map((question) => {
    if (typeof question !== 'string') return {
      label: question.label || 'Diligence item',
      status: question.reason || 'Pending',
      next: question.nextAction || null,
    };
    const [label, detail] = question.split(/\s+[—-]\s+/, 2);
    return { label: label || 'Diligence item', status: detail || 'Pending', next: null };
  }).filter((item) => item.label.trim()).slice(0, 5);
  const actionCards = (nextActions.length ? nextActions : ['Review current evidence']).map((action) => {
    const [label, detail] = action.split(/\s+[—-]\s+/, 2);
    return { label, detail: detail || null };
  }).slice(0, 4);
  const zoningPending = questionCards.some((item) => /zoning|land use/i.test(item.label));
  const knownRiskPattern = /improv|house|whole.?property|septic|terrain|slope|buildab|zoning|access|landlock/i;
  const riskItems: Array<{ label: string; detail: string; tone: 'blocker' | 'caution' | 'pending' }> = [
    ...(showHouseBreakdown && houseValue == null ? [{ label: 'House value pending', detail: 'Whole-property value cannot be completed yet', tone: 'blocker' as const }] : []),
    ...(accessView?.evidence?.parcelFlagged ? [{ label: 'Access conflict', detail: 'Parcel is flagged landlocked', tone: 'blocker' as const }] : !accessEstablished ? [{ label: 'Access pending', detail: 'Physical access evidence remains incomplete', tone: 'pending' as const }] : []),
    ...(soilsSeptic && !/favorable|suitable/i.test(soilsSeptic.categoryLabel) ? [{ label: `Septic: ${soilsSeptic.categoryLabel}`, detail: 'Field testing remains required', tone: 'caution' as const }] : []),
    ...(slopePct != null ? [{ label: `Terrain: ${pctText(slopePct, null)} average slope`, detail: buildabilityPct != null ? `${pctText(buildabilityPct, null)} buildability` : 'Review terrain evidence', tone: 'caution' as const }] : []),
    ...(zoningPending ? [{ label: 'Zoning: Pending', detail: 'Confirm against the official zoning source', tone: 'pending' as const }] : []),
    ...risks.filter((risk) => !knownRiskPattern.test(risk)).slice(0, 2).map((risk) => ({
      label: risk.split(/[.;(]/, 1)[0].replace(/^The subject (?:is|has)\s+/i, '').trim().slice(0, 72),
      detail: 'Review retained risk evidence',
      tone: /pending|unresolved|not confirmed/i.test(risk) ? 'pending' as const : 'caution' as const,
    })),
  ];
  const blockerCount = riskItems.filter((item) => item.tone === 'blocker').length;

  // Key metrics for the decision band: the numbers the operator prices from,
  // ahead of any narrative.
  const decisionMetrics: Array<{ label: string; value: string; sub?: string; tone?: string }> = [
    {
      label: showHouseBreakdown || improvement?.improved ? 'Land value' : 'Property value',
      value: cvSummary?.fmv ? usd(cvSummary.fmv.central) : 'Pending',
      sub: cvSummary ? `${cvSummary.acceptedCount} accepted sale${cvSummary.acceptedCount === 1 ? '' : 's'} · ${cvSummary.statusLabel}` : undefined,
      tone: 'valuation',
    },
    ...(showHouseBreakdown ? [{
      label: 'Whole property',
      value: wholePropertyValue != null ? usd(wholePropertyValue) : 'Pending',
      sub: wholePropertyValue == null ? 'needs the house value' : undefined,
      tone: 'valuation',
    }] : []),
    {
      label: 'Property score',
      value: operator?.scores?.property?.score != null ? String(operator.scores.property.score) : 'Pending',
      sub: operator?.scores?.property?.rating,
      tone: 'property',
    },
    {
      label: 'Access',
      value: accessEstablished ? 'Established' : 'Unresolved',
      sub: accessEstablished ? (accessView?.road ?? undefined) : 'evidence pending',
      tone: accessEstablished ? 'good' : 'risk',
    },
    ...(soilsSeptic ? [{ label: 'Septic outlook', value: soilsSeptic.categoryLabel, tone: 'risk' }] : []),
  ];

  return (
    <main class="awv2-main awv2-overview" data-testid="acquisition-overview">
      {/* ── 1. Decision band: the operator decision and its key metrics lead
             the page; every narrative and evidence surface follows. ── */}
      <section class="awv2-overview-decisionband" data-domain="action" aria-label="Operator decision">
        <div class="awv2-command-head">
          <div><div class="awv2-dom-eyebrow" data-dom="action">Decision</div><h2>{decisionHeadline}</h2></div>
          <span class="awv2-decision-state"><Target size={14} /> Acquisition read</span>
        </div>
        <div class="metrics">
          {decisionMetrics.map((metric) => (
            <div class={`metric tone-${metric.tone ?? 'neutral'}`}>
              <small>{metric.label}</small>
              <b>{metric.value}</b>
              {metric.sub && <span>{metric.sub}</span>}
            </div>
          ))}
        </div>
        <div class="awv2-decision-action">
          <ArrowUpRight size={22} aria-hidden="true" />
          <div><small>Next best action</small><b>{acquisitionNextAction?.label || nextActions[0] || 'Review the current evidence'}</b></div>
        </div>
        {decisionSummary !== decisionHeadline && <details class="awv2-decision-rationale"><summary>Decision rationale</summary><p>{decisionSummary}</p></details>}
      </section>

      <section class="awv2-overview-hero" data-domain="property" aria-label="Subject property">
        <div class="awv2-overview-aerial">
          {heroSrc
            ? <img src={heroSrc} alt={`LandPortal parcel and site context for ${address}`} />
            : <div class="empty">Parcel imagery has not been retained yet.</div>}
          {visualCount > 0 && <span class="count">{visualCount} parcel / site visual{visualCount === 1 ? '' : 's'} retained</span>}
        </div>
        <div class="awv2-overview-facts">
          <div class="awv2-dom-eyebrow" data-dom="property">Property</div>
          <h2>{subjectHeading}</h2>
          <div class="awv2-property-chips">
            <span class={accessEstablished ? 'good' : 'warn'}>{accessEstablished ? <ShieldCheck size={13} /> : <AlertTriangle size={13} />}{accessEstablished ? `Access · ${accessView?.road || 'established'}` : 'Access unresolved'}</span>
            <span><FileCheck2 size={13} /> {visualCount} visual{visualCount === 1 ? '' : 's'}</span>
          </div>
          <div class="awv2-property-fact-grid" aria-label="Property operating facts">
            <div class="wide"><MapPin size={15} /><span><small>Road access</small><b>{accessView?.road || 'Not retained'}</b><i>{accessView?.frontageFt != null ? `${accessView.frontageFt.toLocaleString('en-US', { maximumFractionDigits: 2 })} ft frontage` : accessEstablished ? 'Frontage established' : 'Pending'}</i></span></div>
            <div><Droplets size={15} /><span><small>FEMA · LandPortal</small><b>{pctText(femaPct, femaRaw)}</b><i>{acreageText(affectedAcres(femaPct, femaRaw)) || 'Affected acres not retained'}</i></span></div>
            <div><Waves size={15} /><span><small>Wetlands · LandPortal</small><b>{pctText(wetlandsPct, wetlandsRaw)}</b><i>{acreageText(affectedAcres(wetlandsPct, wetlandsRaw)) || 'Affected acres not retained'}</i></span></div>
            <div><CircleDot size={15} /><span><small>Water feature</small><b>{waterFeature || 'Not retained'}</b><i>LandPortal</i></span></div>
            <div><Mountain size={15} /><span><small>Average slope</small><b>{pctText(slopePct, slopeRaw)}</b><i>LandPortal</i></span></div>
            <div class="wide"><Ruler size={15} /><span><small>Buildability</small><b>{pctText(buildabilityPct, buildabilityRaw)}</b><i>{acreageText(affectedAcres(buildabilityPct, buildabilityRaw)) ? `${acreageText(affectedAcres(buildabilityPct, buildabilityRaw))} buildable` : 'Buildable acres not retained'}</i></span></div>
          </div>
          <div class="awv2-seller-card">
            <UserRound size={22} aria-hidden="true" />
            <div><small>Seller / lead</small><b>{seller?.name || 'Not collected'}</b><span>{seller?.phone || seller?.email || 'Contact details pending'}</span></div>
          </div>
          <dl>
            {identity.apn && <><dt>APN</dt><dd>{identity.apn}</dd></>}
            {zip && <><dt>ZIP</dt><dd>{zip}</dd></>}
            {improvement?.buildingSqft != null && <><dt>{subjectStructure}</dt><dd>{Math.round(improvement.buildingSqft).toLocaleString('en-US')} sqft</dd></>}
          </dl>
          {snap.subjectParcelUrl && <a href={snap.subjectParcelUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} /> Open parcel evidence</a>}
        </div>
      </section>

      {/* ── 2. Valuation: the decision-relevant figures, House Value naming.
             Deep methodology and the audit ledger live in Comps & Valuation. ── */}
      <section class="awv2-overview-valuation" data-domain="valuation" aria-label="Current valuation">
        <div class="section-heading"><div><span class="awv2-dom-eyebrow" data-dom="valuation">Valuation</span><h2>{showHouseBreakdown ? 'Land + house + whole property' : improvement?.improved ? 'Land value established separately; whole-property value pending' : 'Current property valuation'}</h2></div><button type="button" onClick={openCompsValuation}>{openCompsValuationLabel}</button></div>
        {cvSummary ? (
          <>
            <div class="valuation-grid">
              <div class={`primary status-${cvSummary.status}`} data-accepted-count={summary.acceptedCount} title="Land-only indication"><small>{singleResidentialValue ? 'PROPERTY VALUE' : improvement?.improved ? 'LAND VALUE — LAND-ONLY INDICATION' : valuationBasisLabel ?? cvSummary.basisLabel}</small><b>{singleResidentialValue && wholePropertyValue != null ? formatUsd(wholePropertyValue) : cvSummary.fmv ? formatUsd(cvSummary.fmv.central) : 'Not established'}</b><p>{cvSummary.fmv?.low != null && cvSummary.fmv.high != null ? `${formatUsd(cvSummary.fmv.low)}–${formatUsd(cvSummary.fmv.high)} accepted-sale span · ` : ''}{cvSummary.acceptedCount} accepted closed {improvement?.improved ? 'vacant-land ' : ''}sale{cvSummary.acceptedCount === 1 ? '' : 's'} · {cvSummary.statusLabel}</p></div>
              {showHouseBreakdown && (
                <div class="house" aria-label="House value"><small>+ HOUSE VALUE</small><b>{houseValue != null ? formatUsd(houseValue) : 'Pending'}</b><p>{houseValue != null
                  ? `Approx. ${improvement?.buildingSqft != null ? Math.round(improvement.buildingSqft).toLocaleString('en-US') : '—'} sqft residence, valued from improved-sale evidence.`
                  : 'No qualifying improved-sale evidence yet; the house is not separately valued.'}</p></div>
              )}
              {!singleResidentialValue && (
                <div class="whole" aria-label="Whole-property value Pending"><small>= WHOLE-PROPERTY VALUE</small><b>{wholePropertyValue != null ? formatUsd(wholePropertyValue) : improvement?.wholePropertyPending || improvement?.improved ? 'Pending' : cvSummary.fmv ? formatUsd(cvSummary.fmv.central) : 'Not established'}</b><p>{wholePropertyValue != null ? 'Land value plus house value.' : improvement?.improved ? 'Requires the house value; the land figure never prices the residence.' : cvSummary.statusReason}</p></div>
              )}
            </div>
            {cvSummary?.acquisitionLevels && <div class="land-basis-references"><div><span>Opening reference (40% of land value, rounded)</span><b>{landBasisOpeningReference ?? usd(cvSummary.acquisitionLevels.pct40)}</b></div><div><span>Target reference (50% of land value, rounded)</span><b>{usd(cvSummary.acquisitionLevels.pct50)}</b></div><div><span>Ceiling reference (60% of land value, rounded)</span><b>{usd(cvSummary.acquisitionLevels.pct60)}</b></div><p>Land-basis references derived from land value only, rounded to the nearest $500. They are not completed whole-property offer recommendations.</p></div>}
          </>
        ) : <p class="empty">Canonical Comps &amp; Valuation state has not been produced yet.</p>}
      </section>

      {/* ── 3. Score and risks ── */}
      <section class="awv2-overview-decision" data-domain="risk" aria-label="Score and major risks">
        <div class="summary"><span class="awv2-dom-eyebrow" data-dom="risk">Risk scan</span><div class={`awv2-risk-count ${blockerCount ? 'open' : 'clear'}`}>{blockerCount ? <AlertTriangle size={20} /> : <CheckCircle2 size={20} />}<b>{blockerCount}</b><span>{blockerCount === 1 ? 'deal blocker' : 'deal blockers'}</span></div></div>
        <ScoreCard view={operator?.scores?.property} />
        <div class="risks">
          <h2>Risk signals</h2>
          <div class="awv2-risk-items">{(riskItems.length ? riskItems : [{ label: 'No material risk retained', detail: 'Continue ordinary diligence', tone: 'pending' as const }]).slice(0, 5).map((item) => (
            <div class={`awv2-risk-item ${item.tone}`}>
              {item.tone === 'blocker' ? <AlertTriangle size={15} /> : item.tone === 'caution' ? <CircleDot size={15} /> : <FileCheck2 size={15} />}
              <span><b>{item.label}</b><small>{item.detail}</small></span>
              <em>{item.tone === 'blocker' ? 'Blocker' : item.tone === 'caution' ? 'Watch' : 'Pending'}</em>
            </div>
          ))}</div>
        </div>
      </section>

      {/* ── 4. Market intelligence ── */}
      <section class="awv2-overview-market" data-domain="market" aria-label="Market intelligence">
        <div class="section-heading"><div><span class="awv2-dom-eyebrow" data-dom="market">Market intelligence</span><h2>Local market read</h2></div><button type="button" onClick={() => onOpenSection('property-intelligence')}>Open Market Intelligence →</button></div>
        {marketTiles.length > 0
          ? <div class="awv2-market-tiles">{marketTiles.slice(0, 5).map((tile) => <div data-kind={tile.kind}><span>{tile.label}</span><b>{tile.value}</b><i /></div>)}</div>
          : <div class="awv2-market-empty"><span>No retained market pulse</span><b>Price from subject evidence</b><small>Market context remains compact until a supported record exists.</small></div>}
        {narrative?.overviewMarketLine && <details class="awv2-market-detail"><summary>Market interpretation</summary><p>{narrative.overviewMarketLine}</p></details>}
      </section>

      <section class={`awv2-overview-listing awv2-marketing-compact ${listing?.onMarket ? 'active' : 'inactive'}`} data-domain="evidence" aria-label="Public marketing status">
        <div class="awv2-marketing-state">
          <span class="awv2-dom-eyebrow" data-dom="evidence">Public marketing</span>
          <h2>{listing?.onMarket ? listing.statusLabel : 'Off Market'}</h2>
          <p>{listing?.onMarket
            ? [listing.currentPrice != null ? formatUsd(listing.currentPrice) : null, listing.listingAgeDays != null ? `${listing.listingAgeDays} days listed` : null].filter(Boolean).join(' · ') || 'Verified public listing'
            : 'No verified public listing'}</p>
        </div>
        <button type="button" onClick={openListingEvidence}>View listing evidence →</button>
      </section>

      <section class="awv2-overview-access" data-domain="property" aria-label="Access evidence ladder">
        <div class="section-heading"><div><span class="awv2-dom-eyebrow" data-dom="property">Access</span><h2>{accessEstablished ? 'Access established' : 'Physical evidence is not legal proof'}</h2></div><button type="button" onClick={() => onOpenSection('property-intelligence')}>Open property evidence →</button></div>
        <p>{accessConclusion}</p>
        {/* Established access keeps its evidence ladder as collapsed
            provenance; unresolved access shows the ladder open because the
            gap IS the message. */}
        {accessEstablished ? (
          <details class="awv2-overview-details"><summary>Access evidence provenance</summary>
            <div class="ladder">{accessTiers.map((tier, index) => <div class={`rung ${tier.tone}`}><span class="number">{index + 1}</span><div><small>{tier.label}</small><b>{tier.state}</b>{tier.detail && <p>{tier.detail}</p>}</div></div>)}</div>
            <p>Recorded-instrument access remains ordinary closing diligence, not a discovery-stage blocker.</p>
          </details>
        ) : (
          <div class="ladder">{accessTiers.map((tier, index) => <div class={`rung ${tier.tone}`}><span class="number">{index + 1}</span><div><small>{tier.label}</small><b>{tier.state}</b>{tier.detail && <p>{tier.detail}</p>}</div></div>)}</div>
        )}
      </section>

      {visualBuyerSummary && (
        <section class="awv2-overview-access" data-domain="evidence" aria-label="Visual buyer summary">
          <div class="section-heading"><div><span>{visualBuyerSummaryLabel}</span><h2>{visualBuyerSummary.physicalCharacter || 'Physical character not summarized'}</h2></div><button type="button" onClick={onOpenVisualBuyerAnalysis}>{visualBuyerAnalysisLabel}</button></div>
          <p><b>Buyer appeal:</b> {visualBuyerSummary.mainBuyerAppeal || 'Not summarized'} · <b>Top concern:</b> {visualBuyerSummary.topConcern || 'Not summarized'}</p>
        </section>
      )}

      {soilsSeptic && (
        <section class="awv2-overview-access" data-domain="risk" aria-label="Septic outlook">
          <div class="section-heading"><div><span>Septic outlook</span><h2>{soilsSeptic.categoryLabel}</h2></div><button type="button" onClick={() => { onOpenSection('property-intelligence'); requestAnimationFrame(() => document.getElementById('soils-septic')?.scrollIntoView({ behavior: 'smooth' })); }}>Open soils &amp; septic evidence →</button></div>
          <p>{soilsSeptic.conclusion} Field testing remains required.</p>
        </section>
      )}

      <section class="awv2-overview-closeout" data-domain="action" aria-label="Unresolved diligence and next action">
        <div>
          <span>Still unresolved</span>
          <h2>Diligence queue</h2>
          {status?.questionsHeadline && <p class="questions">{status.questionsHeadline}</p>}
          <div class="awv2-diligence-rows">{(questionCards.length ? questionCards : (unresolved.length ? unresolved : ['No unresolved question is listed']).map((item) => ({ label: item.split(/\s+[—-]\s+/, 1)[0], status: 'Pending', next: null }))).slice(0, 5).map((item) => (
            <div class="awv2-diligence-row"><FileCheck2 size={15} /><span><b>{item.label}</b><small>{item.status}</small></span><em>{item.next || 'Review'}</em></div>
          ))}</div>
        </div>
        <div class="next">
          <span>What happens next</span>
          <h2>Operator actions</h2>
          <div class="awv2-action-rows">{actionCards.map((item, index) => (
            <div class="awv2-action-row"><b>{index + 1}</b><span><strong>{item.label}</strong>{item.detail && <small>{item.detail}</small>}</span><ArrowUpRight size={15} /></div>
          ))}</div>
        </div>
      </section>

      {(methodology.length > 0 || askingPrice != null) && <details class="awv2-overview-methodology"><summary>Supporting assumptions and secondary details</summary>{askingPrice != null && <p>Seller-stated asking price: {formatUsd(askingPrice)}.</p>}<ul>{methodology.map((item) => <li>{item}</li>)}</ul></details>}
    </main>
  );
}
