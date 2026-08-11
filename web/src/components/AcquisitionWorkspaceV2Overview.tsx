import { ExternalLink } from 'lucide-preact';

import { dashboardToken } from '@/lib/api';

import type {
  AccessPresentationView,
  ExactAddressListingsView,
  ListingCardView,
  ListingEngagementSignalView,
  ListingEventView,
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
  openQuestions?: string[];
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

const listingPhotoSrc = (url: string): string => (url.startsWith('/api/')
  ? `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(dashboardToken)}`
  : url);

/**
 * Engagement reaches Overview ONLY when the provider actually published it.
 * An absent measure is left off the card entirely: it is never rendered as
 * zero and never inferred. The full per-provider read lives in Property
 * Intelligence.
 */
function availableEngagement(signals: ListingEngagementSignalView[]): Array<{ label: string; value: string }> {
  const tiles: Array<{ label: string; value: string }> = [];
  for (const signal of signals) {
    if (signal.viewsAvailability === 'available' && signal.views != null) {
      tiles.push({ label: `${signal.sourceLabel} views`, value: signal.views.toLocaleString('en-US') });
    }
    if (signal.savesAvailability === 'available' && signal.saves != null) {
      tiles.push({ label: `${signal.sourceLabel} saves`, value: signal.saves.toLocaleString('en-US') });
    }
  }
  return tiles;
}

/** The most recent retained price change, when one is genuinely retained. */
function latestPriceChange(card: ListingCardView, usd: (value: number) => string): string | null {
  const changes = card.priceChanges.filter((event) => event.price != null);
  const latest: ListingEventView | undefined = changes[changes.length - 1];
  if (!latest) return null;
  // A reduction row publishes either the new asking price ("reduced to
  // $1,450,000") or the amount it came down by ("Price cut: $145K"). Saying
  // "to" for the second states the discount as the price.
  const preposition = latest.isReductionAmount ? 'by' : 'to';
  return `${latest.event}${latest.date ? ` ${latest.date}` : ''} ${preposition} ${usd(latest.price!)}`;
}

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
  const negotiation = compsValuation?.negotiation ?? null;
  const usd = formatUsd;
  const status = researchStatus as ResearchStatusDetail | null;

  // Overview never derives a second comp count or valuation requirement. The
  // Comps & Valuation projection is the single authority for both.
  const decisionSummary = canonical?.decisionSummary || overall?.recommendation || overall?.mainOpportunity || 'Current decision summary is pending accepted research.';
  const risks = unique(canonical?.blockers?.length ? canonical.blockers : overall?.mainRisks ?? []);
  const unresolved = unique(canonical?.missingInformation?.length ? canonical.missingInformation : overall?.unansweredQuestions ?? []);
  const canonicalActions = unique(canonical?.nextActions?.length ? canonical.nextActions : overall?.nextBestActions ?? []);
  const nextActions = unique([
    acquisitionNextAction?.label ? `${acquisitionNextAction.label}${acquisitionNextAction.reason ? ` — ${acquisitionNextAction.reason}` : ''}` : null,
    ...canonicalActions,
  ]);

  // The reconciled subject decides whether a public listing exists. Overview no
  // longer re-derives it from whichever retained source sorted first, which is
  // how an actively listed subject was reported as having no listing at all.
  const listing = exactAddressListings?.listingCard ?? null;
  const listingPhoto = listing?.primaryPhotoUrl ? listingPhotoSrc(listing.primaryPhotoUrl) : null;
  const listingDays = listing?.listingAgeDays ?? null;
  // Zillow keeps its own two tiles because the operator reads them every time;
  // an unpublished measure states that plainly instead of showing a zero. Every
  // other provider appears only where it actually published something, and
  // Zillow is excluded BY PROVIDER rather than by object identity: a second
  // Zillow read is the same measure, and rendering it beside the dedicated
  // tiles is how "Zillow views" and "zillow.com views" both appeared.
  const zillowEngagement = listing?.zillowEngagement ?? null;
  const zillowViews = zillowEngagement?.viewsAvailability === 'available' ? zillowEngagement.views : null;
  const zillowSaves = zillowEngagement?.savesAvailability === 'available' ? zillowEngagement.saves : null;
  const engagementTiles = listing
    ? availableEngagement(listing.engagementByProvider.filter((signal) => signal.provider !== 'zillow'))
    : [];
  const priceChange = listing ? latestPriceChange(listing, formatUsd) : null;
  const listingFacts = listing ? unique([
    listing.improvementFacts.propertyType,
    listing.improvementFacts.buildingSqft != null ? `${Math.round(listing.improvementFacts.buildingSqft).toLocaleString('en-US')} sqft` : null,
    listing.improvementFacts.beds != null ? `${listing.improvementFacts.beds} beds` : null,
    listing.improvementFacts.baths != null ? `${listing.improvementFacts.baths} baths` : null,
    listing.improvementFacts.yearBuilt != null ? `built ${listing.improvementFacts.yearBuilt}` : null,
    listing.acres != null ? `${listing.acres.toLocaleString('en-US', { maximumFractionDigits: 2 })} acres` : null,
  ]) : [];
  const openListingEvidence = () => {
    onOpenSection('property-intelligence');
    requestAnimationFrame(() => document.getElementById('exact-address-listing-evidence')?.scrollIntoView({ behavior: 'smooth' }));
  };

  const accessTiers = [
    {
      label: 'Parcel / landlocked flag',
      state: accessView?.evidence?.parcelFlagged ? 'Flagged landlocked' : accessView?.evidence ? 'Not flagged landlocked' : 'Not resolved',
      tone: accessView?.evidence?.parcelFlagged ? 'risk' : 'neutral',
      detail: accessView?.evidence?.byTier.parcel_flag?.[0]?.statement,
    },
    {
      label: 'Apparent physical access',
      state: accessView?.evidence?.apparentPhysicalAccess ? 'Apparent route observed' : 'Not established',
      tone: accessView?.evidence?.apparentPhysicalAccess ? 'observed' : 'neutral',
      detail: accessView?.evidence?.byTier.apparent_physical?.[0]?.statement,
    },
    {
      label: 'Reported legal / easement access',
      state: accessView?.evidence?.reportedLegalAccess ? 'Reported' : 'Not reported',
      tone: accessView?.evidence?.reportedLegalAccess ? 'reported' : 'neutral',
      detail: accessView?.evidence?.byTier.reported_legal?.[0]?.statement,
    },
    {
      label: 'Verified recorded legal access',
      state: accessView?.evidence?.verifiedLegalAccess ? 'Verified' : 'Not verified',
      tone: accessView?.evidence?.verifiedLegalAccess ? 'verified' : 'risk',
      detail: accessView?.evidence?.byTier.verified_legal?.[0]?.statement,
    },
  ];
  const accessConclusion = accessView?.evidence?.operatorConclusion
    ?? (accessView?.established
      ? `Mapped road abutment: ${accessView.legalAccess}. Apparent entrance: ${accessView.apparentEntrance.charAt(0).toLowerCase()}${accessView.apparentEntrance.slice(1)}. Recorded-instrument access remains separate diligence.`
      : 'Physical and legal access evidence remains unresolved; zoning, septic and utilities still need confirmation.');

  const methodology = unique([...(operator?.methodology?.assumptions ?? []), ...(operator?.methodology?.notes ?? [])]);

  return (
    <main class="awv2-main awv2-overview" data-testid="acquisition-overview">
      <section class="awv2-overview-hero" aria-label="Subject property">
        <div class="awv2-overview-aerial">
          {heroSrc
            ? <img src={heroSrc} alt={`LandPortal parcel and site context for ${address}`} />
            : <div class="empty">Parcel imagery has not been retained yet.</div>}
          {visualCount > 0 && <span class="count">{visualCount} parcel / site visual{visualCount === 1 ? '' : 's'} retained</span>}
        </div>
        <div class="awv2-overview-facts">
          <div class="eyebrow">Subject</div>
          <h2>{improvement?.improved ? 'Materially improved property' : improvement ? 'Vacant land' : 'Improvement status pending'}</h2>
          <p>{improvement?.improved
            ? `${improvement.captionNoun}${improvement.buildingSqft != null ? ` with approximately ${Math.round(improvement.buildingSqft).toLocaleString('en-US')} building sqft` : ''}.`
            : improvement ? 'No retained improvement evidence currently changes the vacant-land classification.' : 'Research has not yet resolved whether material improvements are present.'}</p>
          <dl>
            {identity.apn && <><dt>APN</dt><dd>{identity.apn}</dd></>}
            {zip && <><dt>ZIP</dt><dd>{zip}</dd></>}
            <dt>Seller / lead</dt><dd>{seller?.name || 'Not collected'}</dd>
          </dl>
          {snap.subjectParcelUrl && <a href={snap.subjectParcelUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} /> Open parcel evidence</a>}
        </div>
      </section>

      <section class={`awv2-overview-listing ${listing ? (listing.onMarket ? 'active' : 'retained') : 'inactive'}${listing && !listingPhoto ? ' no-photo' : ''}`} aria-label="Current listing and public marketing">
        {listing && listingPhoto && <img src={listingPhoto} alt={`Listing photo for ${address}`} />}
        <div class="content">
          <div class="eyebrow">Current listing / public marketing</div>
          {listing ? (
            <>
              <div class="heading">
                <h2>{listing.statusLabel}</h2>
                <span>{listing.sourceLabel} · {listing.evidenceLabel} evidence</span>
              </div>
              <div class="metrics">
                <div><span>Current asking price</span><b>{listing.currentPrice != null ? formatUsd(listing.currentPrice) : 'Unavailable'}</b></div>
                <div><span>Original list price</span><b>{listing.originalListPrice != null ? formatUsd(listing.originalListPrice) : 'Unavailable'}</b></div>
                <div><span>Listing age</span><b>{listingDays != null ? `${listingDays} days` : 'Unavailable'}</b></div>
                <div><span>MLS number</span><b>{listing.mlsNumbers.length ? listing.mlsNumbers.join(' · ') : listing.mls || 'Unavailable'}</b></div>
                <div><span>Brokerage</span><b>{listing.brokerage || listing.listingAgent || 'Unavailable'}</b></div>
                <div><span>Zillow views</span><b>{zillowViews != null ? zillowViews.toLocaleString('en-US') : 'Not collected (never shown as zero)'}</b></div>
                <div><span>Zillow saves</span><b>{zillowSaves != null ? zillowSaves.toLocaleString('en-US') : 'Not collected (never shown as zero)'}</b></div>
                {engagementTiles.map((tile) => <div><span>{tile.label}</span><b>{tile.value}</b></div>)}
              </div>
              <p class="listing-facts">{listingFacts.join(' · ') || 'Additional improvement facts were not retained from the listing.'}</p>
              {priceChange && <p class="listing-price-change">Price history: {listing.priceChanges.length} retained change{listing.priceChanges.length === 1 ? '' : 's'}, most recently {priceChange}.</p>}
              {!listing.onMarket && <p class="listing-price-change">{listing.statusNote}</p>}
              <div class="listing-links">
                <a href={listing.listingUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} /> Open listing &amp; photos</a>
                <button type="button" onClick={openListingEvidence}>Listing evidence, photos &amp; reconciliation →</button>
                <span>{listing.photoCount != null ? `${listing.photoCount} listing photo${listing.photoCount === 1 ? '' : 's'} retained` : 'No listing photo retained'} · engagement retrieved {zillowEngagement?.retrievedAt || exactAddressListings?.retrievedAtIso || 'timestamp unavailable'} · interest signal, not proof of value</span>
              </div>
            </>
          ) : (
            <>
              <h2>No public listing record retained</h2>
              <p>{exactAddressListings?.note || 'Exact-address discovery has not retained a public listing record for this subject.'}</p>
            </>
          )}
        </div>
      </section>

      <section class="awv2-overview-decision" aria-label="Current decision state">
        <div class="summary"><span>Current decision</span><p>{decisionSummary}</p></div>
        {narrative?.overviewMarketLine && <div class="summary"><span>Market context</span><p>{narrative.overviewMarketLine}</p></div>}
        <ScoreCard view={operator?.scores?.property} />
        <div class="risks">
          <h2>Major risks</h2>
          <ul>{(risks.length ? risks : ['No major risk has been retained in the current canonical decision state.']).slice(0, 4).map((risk) => <li>{risk}</li>)}</ul>
        </div>
      </section>

      <section class="awv2-overview-access" aria-label="Access evidence ladder">
        <div class="section-heading"><div><span>Access</span><h2>Physical evidence is not legal proof</h2></div><button type="button" onClick={() => onOpenSection('property-intelligence')}>Open property evidence →</button></div>
        <p>{accessConclusion}</p>
        <div class="ladder">{accessTiers.map((tier, index) => <div class={`rung ${tier.tone}`}><span class="number">{index + 1}</span><div><small>{tier.label}</small><b>{tier.state}</b>{tier.detail && <p>{tier.detail}</p>}</div></div>)}</div>
      </section>

      {visualBuyerSummary && (
        <section class="awv2-overview-access" aria-label="Visual buyer summary">
          <div class="section-heading"><div><span>{visualBuyerSummaryLabel}</span><h2>{visualBuyerSummary.physicalCharacter || 'Physical character not summarized'}</h2></div><button type="button" onClick={onOpenVisualBuyerAnalysis}>{visualBuyerAnalysisLabel}</button></div>
          <p><b>Buyer appeal:</b> {visualBuyerSummary.mainBuyerAppeal || 'Not summarized'} · <b>Top concern:</b> {visualBuyerSummary.topConcern || 'Not summarized'}</p>
        </section>
      )}

      {soilsSeptic && (
        <section class="awv2-overview-access" aria-label="Septic outlook">
          <div class="section-heading"><div><span>Septic outlook</span><h2>{soilsSeptic.categoryLabel}</h2></div><button type="button" onClick={() => { onOpenSection('property-intelligence'); requestAnimationFrame(() => document.getElementById('soils-septic')?.scrollIntoView({ behavior: 'smooth' })); }}>Open soils &amp; septic evidence →</button></div>
          <p>{soilsSeptic.conclusion} Field testing remains required.</p>
        </section>
      )}

      <section class="awv2-overview-valuation" aria-label="Current valuation">
        <div class="section-heading"><div><span>Valuation</span><h2>{improvement?.improved ? 'Land value established separately; whole-property value pending' : 'Current property valuation'}</h2></div><button type="button" onClick={openCompsValuation}>{openCompsValuationLabel}</button></div>
        {cvSummary ? (
          <>
            <div class="valuation-grid">
              <div class={`primary status-${cvSummary.status}`} data-accepted-count={summary.acceptedCount} title="Land-only indication"><small>{improvement?.improved ? 'LAND-ONLY INDICATION' : valuationBasisLabel ?? cvSummary.basisLabel}</small><b>{cvSummary.fmv ? formatUsd(cvSummary.fmv.central) : 'Not established'}</b><p>{cvSummary.fmv?.low != null && cvSummary.fmv.high != null ? `${formatUsd(cvSummary.fmv.low)}–${formatUsd(cvSummary.fmv.high)} range · ` : ''}{cvSummary.acceptedCount} accepted closed {improvement?.improved ? 'vacant-land ' : ''}sale{cvSummary.acceptedCount === 1 ? '' : 's'} · {cvSummary.statusLabel}</p></div>
              <div class="whole" aria-label="Whole-property value Pending"><small>WHOLE-PROPERTY VALUE</small><b>{improvement?.wholePropertyPending || improvement?.improved ? 'Pending' : cvSummary.fmv ? formatUsd(cvSummary.fmv.central) : 'Not established'}</b><p>{improvement?.improved ? (improvement.wholePropertyNote || 'Improvements must be valued separately before a whole-property conclusion exists.') : cvSummary.statusReason}</p></div>
            </div>
            {negotiation && <div class="land-basis-references"><div><span>Land-basis opening reference</span><b>{landBasisOpeningReference ?? usd(negotiation.recommendedOpening)}</b></div><div><span>Land-basis target reference</span><b>{cvSummary?.acquisitionLevels ? usd(cvSummary.acquisitionLevels.pct50) : usd(negotiation.recommendedTarget)}</b></div><div><span>Land-basis ceiling reference</span><b>{cvSummary?.acquisitionLevels ? usd(cvSummary.acquisitionLevels.pct60) : usd(negotiation.hardCeiling)}</b></div><p>References derived from land value only. They are not completed whole-property offer recommendations.</p></div>}
          </>
        ) : <p class="empty">Canonical Comps &amp; Valuation state has not been produced yet.</p>}
      </section>

      <section class="awv2-overview-closeout" aria-label="Unresolved diligence and next action">
        <div>
          <span>Still unresolved</span>
          <h2>Diligence questions, not research-lane progress</h2>
          {status?.questionsHeadline && <p class="questions">{status.questionsHeadline}</p>}
          <ul>{(unresolved.length ? unresolved : status?.openQuestions?.length ? status.openQuestions : ['No unresolved question is listed in the current canonical state.']).slice(0, 6).map((item) => <li>{item}</li>)}</ul>
        </div>
        <div class="next">
          <span>What happens next</span>
          <h2>Operator actions</h2>
          <ol>{(nextActions.length ? nextActions : ['Review the current evidence and assign the next diligence action.']).slice(0, 5).map((item) => <li>{item}</li>)}</ol>
        </div>
      </section>

      {(methodology.length > 0 || askingPrice != null) && <details class="awv2-overview-methodology"><summary>Supporting assumptions and secondary details</summary>{askingPrice != null && <p>Seller-stated asking price: {formatUsd(askingPrice)}.</p>}<ul>{methodology.map((item) => <li>{item}</li>)}</ul></details>}
    </main>
  );
}
