// LandOS — the Deal Brain decision and the seller discovery brief.
//
// The decision panel is the operator's answer to "what do I do with this deal
// right now?" It renders a posture LandOS formed automatically when research
// settled, and refreshed only when material evidence moved. Three things it
// must always do, because the alternative has already cost a real deal:
//
//   • Lead with the recommendation and the two next actions. A decision that
//     has to be assembled from panels is not a decision.
//   • Say why there is no price when there is none. Silence about value reads
//     as "no problem"; the no-price rationale reads as the work still owed.
//   • Show what moved it. A refreshed posture names the cause and the exact
//     dimensions that changed, so the operator never wonders why it differs.
//
// The seller discovery panel keeps the one boundary Seller Intelligence rests
// on visible: claims come only from retained communications, attributed to
// the record that carried them, and the brief asks only what the record
// cannot answer.
//
// Rendering runs no model and starts no research: it displays what the
// lifecycle already produced.

import { countyLabel } from '@/lib/format';
import { stage3Lineage, type Stage3StatusView } from './AcquisitionWorkspaceV2IntelligenceStack';

import '../styles/workspace-v2-deal-brain.css';

// ── View types (the fields this surface consumes) ──────────────────────────

export interface DecisionNextActionView {
  action?: string;
  why?: string;
  capabilityId?: string | null;
  unlocks?: string;
}

export interface DecisionEvidenceView {
  key?: string;
  label?: string;
  status?: string;
  statement?: string;
  requiredForOffer?: boolean;
  unlock?: string;
}

export interface DecisionRankedView {
  rank?: number;
  title?: string;
  statement?: string;
  magnitude?: string;
  standing?: string;
  basis?: string;
  action?: string | null;
}

export interface DecisionStrategyView {
  id?: string;
  label?: string;
  status?: string;
  statusWhy?: string;
  keyRequirement?: string;
  criticalGate?: string;
  economicBasis?: string;
  economicBasisConfirmed?: boolean;
}

export interface DecisionSellerClaimView {
  dimension?: string;
  label?: string;
  statement?: string;
  value?: string | null;
  weight?: string;
  confidence?: string;
  modality?: string;
  speaker?: string;
  source?: string;
  at?: string | null;
}

export interface DealDecisionView {
  correlation?: string;
  retainedAt?: string | null;
  snapshotId?: number | null;
  mode?: string;
  modeWhy?: string;
  subject?: {
    apn?: string | null; address?: string | null; city?: string | null; county?: string | null; state?: string | null;
    acres?: number | null; acreageBasis?: string | null; confidence?: string;
    interest?: { statement?: string } | null;
    subjectVersion?: string | null;
    verification?: {
      statement?: string; officiallyVerified?: boolean; officialSource?: string | null;
      lineage?: {
        reached?: boolean; sourceName?: string | null; sourceType?: string; recordId?: string | null; sourceHost?: string | null;
        matchedFields?: { apn?: string | null; county?: string | null; state?: string | null; fips?: string | null };
        observedAt?: string | null; observedAtStatement?: string; subjectVersion?: string | null; distinctions?: string[];
      };
    };
    caveats?: string[];
  };
  /** The one status per Stage 3 input, recorded with the decision. */
  inputs?: { property?: Stage3StatusView | null; market?: Stage3StatusView | null } | null;
  propertyStory?: { headline?: string; strengths?: string[]; risks?: string[]; opportunities?: string[]; establishedTopics?: number; totalTopics?: number } | null;
  marketStory?: {
    headline?: string; liquidityRead?: string; demandRead?: string; competitionRead?: string;
    subjectBand?: { label?: string | null; available?: boolean; medianPricePerAcre?: number | null; sampleCount?: number | null; period?: string | null };
    mostLiquidBand?: { label?: string | null; medianPricePerAcre?: number | null } | null;
  } | null;
  seller?: {
    status?: string; statement?: string; communications?: number; discoveryExtractions?: number; lastContactAt?: string | null;
    claims?: DecisionSellerClaimView[]; unanswered?: string[];
    historicalClaims?: number; conflicts?: number;
    operatorProfileNotes?: Array<{ field?: string; value?: string }>;
  };
  evidence?: DecisionEvidenceView[];
  risks?: DecisionRankedView[];
  opportunities?: DecisionRankedView[];
  exitStrategies?: DecisionStrategyView[];
  value?: {
    status?: string;
    fmv?: { central?: number } | null;
    basis?: string | null;
    acceptedCompCount?: number;
    offerGuidance?: { strategyLabel?: string; lowPct?: number; highPct?: number; low?: number; high?: number; confirmed?: boolean } | null;
    askingPrice?: number | null;
    askingPriceSource?: string | null;
    askingVsGuidance?: string | null;
    noPriceRationale?: string | null;
  };
  nextActions?: { landos?: DecisionNextActionView; operator?: DecisionNextActionView };
  recommendation?: { kind?: string; label?: string; statement?: string; rationale?: string[] };
  refresh?: { cause?: string; kind?: string; changes?: Array<{ dimension?: string; before?: string | null; after?: string }>; priorSnapshotId?: number | null };
  basedOn?: { propertySnapshotId?: number | null; marketSnapshotId?: number | null; subjectVersion?: string | null };
  limitations?: string[];
}

export interface DealDecisionHistoryView {
  snapshotId?: number;
  version?: number;
  retainedAt?: string | null;
  mode?: string;
  recommendation?: { label?: string; statement?: string };
  refresh?: { cause?: string; kind?: string; changes?: Array<{ dimension?: string }> };
}

export interface SellerDiscoveryView {
  correlation?: string;
  retainedAt?: string | null;
  status?: string;
  planning?: { planned?: boolean; reason?: string; signals?: { nextFollowUpDate?: string | null; stage?: string | null } };
  record?: {
    communications?: number; conversationRecords?: number; sellerMessages?: number; operatorMessages?: number;
    operatorNotes?: number; discoveryExtractions?: number; sellerStatedFacts?: number; lastContactAt?: string | null;
  };
  brief?: {
    objective?: string;
    questions?: Array<{ key?: string; topic?: string; question?: string; why?: string; basis?: string; priority?: number; answeredBy?: string[] }>;
    doNotAssume?: string[];
  };
  claims?: Array<{
    claimId?: string; dimension?: string; statement?: string; excerpt?: string; value?: string | null; method?: string; weight?: string;
    speaker?: { role?: string; label?: string };
    polarity?: string; modality?: string; condition?: string | null; confidence?: string;
    status?: string; supersededBy?: string | null; supersessionReason?: string | null;
    source?: { id?: string | null; at?: string | null; type?: string; attribution?: string; kind?: string };
  }>;
  conflicts?: Array<{ dimension?: string; earlier?: { value?: string | null; at?: string | null }; later?: { value?: string | null; at?: string | null } }>;
  unanswered?: string[];
  operatorProfileNotes?: Array<{ field?: string; value?: string }>;
  refusals?: Array<{ record?: string; reason?: string; excerpt?: string }>;
  limitations?: string[];
}

export interface DecisionStabilityView {
  stable?: boolean;
  reason?: string;
}

/** The one seller read status, as the server maps the retained discovery. */
export interface SellerReadStatusView {
  status?: 'pending' | 'preliminary_current' | string;
  label?: string;
  basis?: string;
  communicationIds?: string[];
  lastCommunicationAt?: string | null;
  currentClaims?: number;
  historicalClaims?: number;
  completeness?: string;
  caveat?: string;
}

/**
 * "Current Seller Read" for the Seller page and the Deal Brain: the shared
 * status, and when preliminary, each current position with its speaker,
 * source, date, standing, caveat and the dated position it superseded.
 */
export function SellerReadStatusLine({ status, discovery }: { status: SellerReadStatusView | null | undefined; discovery: SellerDiscoveryView | null | undefined }) {
  const label = status?.label ?? 'Pending — no qualifying seller communication';
  const preliminary = status?.status === 'preliminary_current';
  const claims = discovery?.claims ?? [];
  const positions = ['motivation', 'price', 'timeline', 'decision_maker', 'constraint', 'commitment']
    .map((dimension) => claims.find((claim) => claim.dimension === dimension && (claim.status ?? 'current') === 'current' && (claim.polarity ?? 'asserted') === 'asserted'))
    .filter((claim): claim is NonNullable<typeof claim> => !!claim);
  const superseded = (claim: NonNullable<typeof positions[number]>) => discovery?.conflicts?.find((conflict) => conflict.dimension === claim.dimension && conflict.later?.at === claim.source?.at);
  return (
    <div class="awv2-seller-read" data-testid="seller-read-status" data-status={status?.status ?? 'pending'}>
      <p class="awv2-seller-intel-precontact">
        <b>Current Seller Read: {label}.</b> {status?.basis ?? 'No seller conversation, inbound message or discovery note is retained.'}
        {status?.lastCommunicationAt ? ` Last qualifying communication ${status.lastCommunicationAt.slice(0, 10)}.` : ''}
        {' '}{status?.completeness ?? 'No supported completeness threshold exists for the seller read, so it is never reported as Current.'}
        {' '}Nothing is inferred from ownership records.
      </p>
      {preliminary && !!positions.length && (
        <ul class="awv2-brain-claims" data-testid="seller-read-positions">
          {positions.map((claim) => {
            const moved = superseded(claim);
            return (
              <li data-dimension={claim.dimension} data-claim-id={claim.claimId}>
                <b>{DIMENSION_LABEL[claim.dimension ?? ''] ?? words(claim.dimension)}</b>
                {claim.value ? <> <i class="awv2-brain-claim-value">{claim.value}</i></> : null} “{claim.excerpt ?? claim.statement}”
                <span class="awv2-brain-muted">
                  {' — '}{claim.speaker?.label ?? 'seller'} · {claim.source?.id ?? 'communication id not recorded'} · {claim.source?.at ? claim.source.at.slice(0, 10) : 'undated'}
                  {' · '}{claim.polarity && claim.polarity !== 'asserted' ? claim.polarity : 'asserted'}{claim.modality && claim.modality !== 'firm' ? `, ${claim.modality}${claim.condition ? ` (${claim.condition})` : ''}` : ''}
                  {' · seller-reported, not independently verified'}
                  {moved ? ` · supersedes ${moved.earlier?.value ?? 'an earlier position'} (${moved.earlier?.at?.slice(0, 10) ?? 'undated'})` : ''}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {!!status?.historicalClaims && (
        <span class="awv2-brain-muted">{status.historicalClaims} earlier seller statement(s) remain in history and do not carry the current read.</span>
      )}
    </div>
  );
}

// ── Small shared pieces ────────────────────────────────────────────────────

const MODE_LABEL: Record<string, string> = {
  preliminary_acquisition_posture: 'Preliminary acquisition posture',
  offer_strategy_posture: 'Offer / strategy posture',
};

const DIMENSION_LABEL: Record<string, string> = {
  motivation: 'Motivation',
  price: 'Price expectation',
  timeline: 'Timeline',
  decision_maker: 'Decision maker',
  constraint: 'Constraint',
  commitment: 'Commitment',
  property_claim: 'Seller-reported property claim',
};

const STATUS_TONE: Record<string, string> = {
  sufficient: 'green', partial: 'yellow', missing: 'red',
  supported: 'green', conditional: 'yellow', not_supported: 'red', unknown: 'grey',
};

const usd = (value: number | null | undefined): string =>
  value == null ? 'Unknown' : `$${Math.round(value).toLocaleString('en-US')}`;

const when = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';

const words = (value: string | null | undefined): string => (value ?? '').replace(/_/g, ' ');

type DiscoveryClaimView = NonNullable<SellerDiscoveryView['claims']>[number];
/** The seller's current positions: what the operator may act on. Negated and
 *  withdrawn statements stay visible here, marked, so a denial is not lost. */
const currentSellerClaims = (claims: DiscoveryClaimView[]): DiscoveryClaimView[] => claims.filter((claim) => (claim.status ?? 'current') === 'current');
const historicalSellerClaims = (claims: DiscoveryClaimView[]): DiscoveryClaimView[] => claims.filter((claim) => claim.status === 'historical');

function NotYet({ stability, what }: { stability: DecisionStabilityView | null | undefined; what: string }) {
  return (
    <div class="awv2-pi-note" data-testid={`${what}-not-yet`}>
      {stability?.reason
        ? `${stability.reason} ${what === 'deal-decision' ? 'The full current Property Story is pending, so no current story is presented as a decision input. The Deal Brain forms its first posture the moment the Property Story settles.' : ''}`.trim()
        : `No ${what.replace(/-/g, ' ')} has been produced yet: research has not reached a stable state for this lead.`}
    </div>
  );
}

function NextActionCard({ who, action, testId }: { who: string; action: DecisionNextActionView | undefined; testId: string }) {
  if (!action) return null;
  return (
    <div class="awv2-brain-action" data-testid={testId}>
      <small>{who}</small>
      <b>{action.action}</b>
      <span>{action.why}</span>
      <span class="awv2-brain-action-unlock">Unlocks: {action.unlocks}{action.capabilityId ? ` · ${action.capabilityId}` : ''}</span>
    </div>
  );
}

// ── Deal Brain decision ────────────────────────────────────────────────────

/** One Stage 3 input, exactly as the Overview card states it. */
function Stage3InputLine({ input }: { input: Stage3StatusView | null | undefined }) {
  if (!input) return null;
  const lineage = stage3Lineage(input);
  return (
    <span class="awv2-brain-muted" data-testid={`deal-decision-input-${input.product === 'market_story' ? 'market' : 'property'}`}>
      {input.label}{input.consumedByDealBrain ? ' · consumed by this decision' : ''}
      {lineage ? ` · ${lineage}` : ''}
      {input.coverage ? ` · ${input.coverage}` : ''}
      {input.limitation ? ` · ${input.limitation}` : ''}
      {input.link ? <> · <a href={input.link}>Open {input.product === 'market_story' ? 'Market' : 'Property'} output</a></> : null}
    </span>
  );
}

export function DealBrainDecisionPanel({ decision, stability, history, stage3, sellerReadStatus }: {
  decision: DealDecisionView | null | undefined;
  stability?: DecisionStabilityView | null;
  history?: DealDecisionHistoryView[] | null;
  /** The live shared Stage 3 status (same rows, same mapping as the score cards). */
  stage3?: { property?: Stage3StatusView | null; market?: Stage3StatusView | null } | null;
  sellerReadStatus?: SellerReadStatusView | null;
}) {
  const subject = decision?.subject;
  const value = decision?.value;
  const seller = decision?.seller;
  const changes = decision?.refresh?.changes ?? [];
  // The live status wins; the status the decision recorded is the fallback.
  const propertyInput = stage3?.property ?? decision?.inputs?.property ?? null;
  const marketInput = stage3?.market ?? decision?.inputs?.market ?? null;
  return (
    <section data-domain="strategy" class="awv2-panel awv2-brain" id="deal-brain-decision" data-testid="deal-brain-decision">
      <div class="awv2-panel-title">
        Deal Brain
        <span class="awv2-src-tag">
          Automatic decision above Property, Market and Seller Intelligence — refreshed only when material evidence moves
        </span>
      </div>
      {!decision || !decision.recommendation ? <NotYet stability={stability} what="deal-decision" /> : (
        <>
          {decision.correlation && decision.correlation !== 'equivalent' && (
            <div class="awv2-story-stale" data-testid="deal-decision-correlation">
              This decision was formed about a different or uncorrelated parcel version and is shown as history, not as current guidance.
            </div>
          )}

          <div class="awv2-brain-mode" data-mode={decision.mode} data-testid="deal-decision-mode">
            <span class="awv2-brain-mode-tag">{MODE_LABEL[decision.mode ?? ''] ?? words(decision.mode)}</span>
            <span>{decision.modeWhy}</span>
          </div>

          <p class="awv2-brain-recommendation" data-kind={decision.recommendation.kind} data-testid="deal-decision-recommendation">
            {decision.recommendation.statement}
          </p>
          {!!decision.recommendation.rationale?.length && (
            <ul class="awv2-brain-rationale" data-testid="deal-decision-rationale">
              {decision.recommendation.rationale.map((line) => <li>{line}</li>)}
            </ul>
          )}

          <div class="awv2-brain-actions" data-testid="deal-decision-next-actions">
            <NextActionCard who="LandOS next action" action={decision.nextActions?.landos} testId="deal-decision-landos-action" />
            <NextActionCard who="Operator next action" action={decision.nextActions?.operator} testId="deal-decision-operator-action" />
          </div>

          <div class="awv2-brain-grid">
            <div class="awv2-brain-block" data-testid="deal-decision-subject">
              <small>Working Acquisition Subject · {words(subject?.confidence) || 'unresolved'}</small>
              <b>{subject?.apn ?? 'APN not established'}{subject?.acres != null ? ` · ${subject.acres} ac` : ''}</b>
              <span>{[subject?.address, subject?.city, countyLabel(subject?.county), subject?.state].filter(Boolean).join(', ')}</span>
              {subject?.interest?.statement && <span>{subject.interest.statement}</span>}
              <span class="awv2-brain-muted" data-testid="deal-decision-identity-statement">{subject?.verification?.statement}</span>
              {subject?.verification?.lineage && (
                <ul class="awv2-brain-caveats" data-testid="deal-decision-identity-lineage" data-reached={String(!!subject.verification.lineage.reached)}>
                  <li>Source: {subject.verification.lineage.sourceName ?? 'none retained'} ({words(subject.verification.lineage.sourceType) || 'none'})</li>
                  <li>Record: {subject.verification.lineage.recordId ?? 'no retained record reached'}{subject.verification.lineage.sourceHost ? ` · ${subject.verification.lineage.sourceHost}` : ''}</li>
                  {subject.verification.lineage.reached && (
                    <li>Matched: {[subject.verification.lineage.matchedFields?.apn ? `APN ${subject.verification.lineage.matchedFields.apn}` : null, countyLabel(subject.verification.lineage.matchedFields?.county), subject.verification.lineage.matchedFields?.state, subject.verification.lineage.matchedFields?.fips ? `FIPS ${subject.verification.lineage.matchedFields.fips}` : null].filter(Boolean).join(', ')}</li>
                  )}
                  <li>Observed: {subject.verification.lineage.observedAtStatement}</li>
                  <li>Accepted subject: {subject.verification.lineage.subjectVersion ?? subject.subjectVersion ?? 'version not recorded'}</li>
                  {(subject.verification.lineage.distinctions ?? []).map((line) => <li>{line}</li>)}
                </ul>
              )}
              {!!subject?.caveats?.length && (
                <ul class="awv2-brain-caveats">{subject.caveats.map((caveat) => <li>{caveat}</li>)}</ul>
              )}
            </div>

            <div class="awv2-brain-block" data-testid="deal-decision-value">
              <small>Value and offer guidance</small>
              {value?.status === 'supported' ? (
                <>
                  <b>{usd(value.fmv?.central)} supported by {value.acceptedCompCount} accepted sale(s)</b>
                  {value.offerGuidance && (
                    <span>
                      {value.offerGuidance.strategyLabel} band {value.offerGuidance.lowPct}–{value.offerGuidance.highPct}%: {usd(value.offerGuidance.low)}–{usd(value.offerGuidance.high)}
                      {value.offerGuidance.confirmed ? '' : ' (draft parameters)'}
                    </span>
                  )}
                  {value.askingVsGuidance && <span>{value.askingVsGuidance}</span>}
                </>
              ) : (
                <>
                  <b>No offer range yet</b>
                  <span data-testid="deal-decision-no-price">{value?.noPriceRationale}</span>
                </>
              )}
              {value?.askingPrice != null && <span class="awv2-brain-muted">Asking price on file: {usd(value.askingPrice)} — {value.askingPriceSource}</span>}
            </div>

            <div class="awv2-brain-block" data-testid="deal-decision-seller" data-seller-read={sellerReadStatus?.status ?? undefined}>
              <small>Seller status · {sellerReadStatus?.label ?? words(seller?.status)}</small>
              <span>{seller?.statement}</span>
              {!!seller?.claims?.length && (
                <ul class="awv2-brain-claims">
                  {seller.claims.slice(0, 8).map((claim) => (
                    <li data-dimension={claim.dimension} data-confidence={claim.confidence}>
                      <b>{claim.label}</b>{claim.value ? <> <i class="awv2-brain-claim-value">{claim.value}</i></> : null} “{claim.statement}”
                      <span class="awv2-brain-muted"> — {claim.speaker ?? claim.source}{claim.at ? ` · ${claim.at.slice(0, 10)}` : ''} · {claim.confidence ?? words(claim.weight)} confidence{claim.modality && claim.modality !== 'firm' ? ` · ${claim.modality}` : ''}</span>
                    </li>
                  ))}
                </ul>
              )}
              {!!seller?.historicalClaims && (
                <span class="awv2-brain-muted" data-testid="deal-decision-seller-history">
                  {seller.historicalClaims} earlier seller statement(s) superseded by later communications; the decision reads only the seller's current positions.
                </span>
              )}
              {!!seller?.operatorProfileNotes?.length && (
                <span class="awv2-brain-muted">
                  Operator profile notes (not seller claims): {seller.operatorProfileNotes.map((note) => `${words(note.field)}: ${note.value}`).join('; ')}
                </span>
              )}
            </div>
          </div>

          <div class="awv2-brain-stories">
            <div class="awv2-brain-block" data-testid="deal-decision-property-story" data-stage3-status={propertyInput?.status ?? undefined} data-snapshot-id={propertyInput?.snapshotId ?? undefined}>
              <small>Property Story · {propertyInput?.label ?? 'status not recorded'}{decision.propertyStory ? ` · ${decision.propertyStory.establishedTopics}/${decision.propertyStory.totalTopics} topics established` : ''}</small>
              {decision.propertyStory && propertyInput?.status !== 'pending' && propertyInput?.status !== 'historical'
                ? <b>{decision.propertyStory.headline}</b>
                : <b>The full current Property Story is pending; the posture above is a limited evidence-sufficiency read.</b>}
              <Stage3InputLine input={propertyInput} />
            </div>
            <div class="awv2-brain-block" data-testid="deal-decision-market-story" data-stage3-status={marketInput?.status ?? undefined} data-snapshot-id={marketInput?.snapshotId ?? undefined}>
              <small>Market Story · {marketInput?.label ?? 'status not recorded'}{decision.marketStory ? ` · subject band ${decision.marketStory.subjectBand?.label ?? 'unavailable'}` : ''}</small>
              {decision.marketStory && marketInput?.status !== 'pending' && marketInput?.status !== 'historical' ? (
                <>
                  <b>{decision.marketStory.headline}</b>
                  <span>{decision.marketStory.liquidityRead}</span>
                  {decision.marketStory.mostLiquidBand?.label && (
                    <span class="awv2-brain-muted">Most liquid band for contrast, not the subject: {decision.marketStory.mostLiquidBand.label}</span>
                  )}
                </>
              ) : <b>The full current Market Story is pending; market liquidity and the subject band are not decision inputs yet.</b>}
              <Stage3InputLine input={marketInput} />
            </div>
          </div>

          <div class="awv2-brain-evidence" data-testid="deal-decision-evidence">
            <small>Evidence sufficiency — what the offer posture requires</small>
            <div class="awv2-brain-evidence-grid">
              {(decision.evidence ?? []).map((row) => (
                <div class="awv2-brain-evidence-row" data-status={row.status} data-tone={STATUS_TONE[row.status ?? ''] ?? 'grey'} data-key={row.key}>
                  <b>{row.label}{row.requiredForOffer ? ' *' : ''}</b>
                  <span class="awv2-brain-evidence-status">{row.status}</span>
                  <span>{row.statement}</span>
                  {row.status !== 'sufficient' && <span class="awv2-brain-muted">Unlock: {row.unlock}</span>}
                </div>
              ))}
            </div>
            <span class="awv2-brain-muted">* required before an offer / strategy posture forms</span>
          </div>

          <div class="awv2-brain-columns">
            <div data-testid="deal-decision-risks">
              <small>Material risks, ranked</small>
              <ol>
                {(decision.risks ?? []).map((risk) => (
                  <li data-magnitude={risk.magnitude}>
                    <b>{risk.title}</b> {risk.statement}
                    <span class="awv2-brain-muted"> — {words(risk.standing)} · {risk.basis}{risk.action ? ` · Resolves with: ${risk.action}` : ''}</span>
                  </li>
                ))}
              </ol>
            </div>
            <div data-testid="deal-decision-opportunities">
              <small>Opportunities, ranked</small>
              <ol>
                {(decision.opportunities ?? []).map((item) => (
                  <li data-magnitude={item.magnitude}>
                    <b>{item.title}</b> {item.statement}
                    <span class="awv2-brain-muted"> — {words(item.standing)} · {item.basis}{item.action ? ` · ${item.action}` : ''}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>

          <div class="awv2-brain-strategies" data-testid="deal-decision-strategies">
            <small>Exit strategies — status, key requirement, critical gate, economic basis</small>
            <div class="awv2-brain-strategy-grid">
              {(decision.exitStrategies ?? []).map((strategy) => (
                <div class="awv2-brain-strategy" data-status={strategy.status} data-tone={STATUS_TONE[strategy.status ?? ''] ?? 'grey'} data-strategy={strategy.id}>
                  <b>{strategy.label}</b>
                  <span class="awv2-brain-strategy-status">{words(strategy.status)}</span>
                  <span>{strategy.statusWhy}</span>
                  <span><i>Key requirement:</i> {strategy.keyRequirement}</span>
                  <span><i>Critical gate:</i> {strategy.criticalGate}</span>
                  <span class="awv2-brain-muted"><i>Economic basis:</i> {strategy.economicBasis}</span>
                </div>
              ))}
            </div>
          </div>

          <div class="awv2-brain-refresh" data-testid="deal-decision-refresh" data-kind={decision.refresh?.kind}>
            <small>What formed this decision</small>
            <span>
              {decision.refresh?.kind === 'material'
                ? `Refreshed by ${words(decision.refresh?.cause)}: ${changes.length} material dimension(s) moved.`
                : decision.refresh?.kind === 'contract'
                  ? `Re-formed under the current decision contract by ${words(decision.refresh?.cause)}; no material evidence moved.`
                  : `Initial decision, formed by ${words(decision.refresh?.cause)}.`}
              {decision.retainedAt ? ` Retained ${when(decision.retainedAt)}.` : ''}
              {decision.basedOn?.propertySnapshotId != null ? ` Based on Property Story #${decision.basedOn.propertySnapshotId}` : ''}
              {decision.basedOn?.marketSnapshotId != null ? ` and Market Story #${decision.basedOn.marketSnapshotId}.` : ''}
            </span>
            {!!changes.length && (
              <ul class="awv2-brain-changes">
                {changes.map((change) => (
                  <li><b>{words(change.dimension)}</b> {change.before ?? 'unknown'} → {change.after}</li>
                ))}
              </ul>
            )}
            {!!history?.length && (
              <details class="awv2-brain-history" data-testid="deal-decision-history">
                <summary>Prior decisions ({history.length})</summary>
                <ul>
                  {history.map((entry) => (
                    <li>
                      <b>{MODE_LABEL[entry.mode ?? ''] ?? words(entry.mode)}</b> {entry.recommendation?.statement}
                      <span class="awv2-brain-muted"> — {words(entry.refresh?.kind)} by {words(entry.refresh?.cause)}{entry.retainedAt ? ` · ${when(entry.retainedAt)}` : ''}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>

          {!!decision.limitations?.length && (
            <div class="awv2-brain-limits" data-testid="deal-decision-limitations">
              <small>Limitations</small>
              <ul>{decision.limitations.map((entry) => <li>{entry}</li>)}</ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ── Seller discovery ───────────────────────────────────────────────────────

export function SellerDiscoveryPanel({ discovery, stability, readStatus }: {
  discovery: SellerDiscoveryView | null | undefined;
  stability?: DecisionStabilityView | null;
  /** The shared seller read status; shown so the brief and the read agree. */
  readStatus?: SellerReadStatusView | null;
}) {
  const record = discovery?.record;
  const questions = discovery?.brief?.questions ?? [];
  const open = questions.filter((question) => !question.answeredBy?.length);
  const answered = questions.filter((question) => !!question.answeredBy?.length);
  return (
    <section class="awv2-activity-seller-discovery awv2-brain-discovery" data-domain="action" data-testid="seller-discovery">
      <div class="awv2-dom-eyebrow" data-dom="action">Seller Discovery</div>
      {!discovery || !discovery.brief ? <NotYet stability={stability} what="seller-discovery" /> : (
        <>
          {discovery.correlation && discovery.correlation !== 'equivalent' && (
            <div class="awv2-story-stale" data-testid="seller-discovery-correlation">
              This brief was formed about a different or uncorrelated parcel version and is shown as history.
            </div>
          )}
          <div class="awv2-brain-discovery-status" data-status={discovery.status} data-testid="seller-discovery-status">
            <b>{readStatus?.label ?? (discovery.status === 'communications_read' ? 'Communications read' : 'No seller communications retained')}</b>
            <span>{discovery.planning?.reason}</span>
            {record && (
              <span class="awv2-brain-muted">
                {record.conversationRecords ?? 0} conversation record(s) · {record.sellerMessages ?? 0} seller message(s) · {record.discoveryExtractions ?? 0} discovery note(s)
                {record.operatorMessages ? ` · ${record.operatorMessages} operator message(s) refused as claim sources` : ''}
                {record.operatorNotes ? ` · ${record.operatorNotes} operator note(s) refused` : ''}
                {record.lastContactAt ? ` · last contact ${record.lastContactAt.slice(0, 10)}` : ''}
              </span>
            )}
          </div>

          {!!discovery.claims?.length && (
            <div class="awv2-brain-discovery-claims" data-testid="seller-discovery-claims">
              <small>What the seller has said — from retained communications only</small>
              <ul>
                {currentSellerClaims(discovery.claims).map((claim) => (
                  <li data-dimension={claim.dimension} data-claim-id={claim.claimId} data-status={claim.status} data-polarity={claim.polarity} data-confidence={claim.confidence}>
                    <b>{DIMENSION_LABEL[claim.dimension ?? ''] ?? words(claim.dimension)}</b>
                    {claim.value ? <> <i class="awv2-brain-claim-value">{claim.value}</i></> : null} “{claim.excerpt ?? claim.statement}”
                    <span class="awv2-brain-muted">
                      {' — '}{claim.speaker?.label ?? claim.source?.attribution}{claim.source?.at ? ` · ${claim.source.at.slice(0, 10)}` : ''}
                      {claim.source?.id ? ` · ${claim.source.id}` : ''} · {claim.confidence ?? words(claim.weight)} confidence
                      {claim.modality && claim.modality !== 'firm' ? ` · ${claim.modality}${claim.condition ? ` (${claim.condition})` : ''}` : ''}
                      {claim.polarity && claim.polarity !== 'asserted' ? ` · ${claim.polarity}` : ''}
                      {claim.method === 'text_match' ? ' · text match' : ''}
                    </span>
                  </li>
                ))}
              </ul>
              {!!historicalSellerClaims(discovery.claims).length && (
                <details class="awv2-brain-history" data-testid="seller-discovery-history">
                  <summary>Earlier seller statements, superseded ({historicalSellerClaims(discovery.claims).length})</summary>
                  <ul>
                    {historicalSellerClaims(discovery.claims).map((claim) => (
                      <li data-dimension={claim.dimension} data-claim-id={claim.claimId} data-status="historical">
                        <b>{DIMENSION_LABEL[claim.dimension ?? ''] ?? words(claim.dimension)}</b>{claim.value ? <> <i class="awv2-brain-claim-value">{claim.value}</i></> : null} “{claim.excerpt ?? claim.statement}”
                        <span class="awv2-brain-muted"> — {claim.speaker?.label ?? claim.source?.attribution}{claim.source?.at ? ` · ${claim.source.at.slice(0, 10)}` : ''}{claim.supersessionReason ? ` · ${claim.supersessionReason}` : ''}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {!!discovery.conflicts?.length && (
                <span class="awv2-brain-muted" data-testid="seller-discovery-conflicts">
                  Positions that moved: {discovery.conflicts.map((conflict) => `${DIMENSION_LABEL[conflict.dimension ?? ''] ?? conflict.dimension} ${conflict.earlier?.value ?? '?'} (${conflict.earlier?.at?.slice(0, 10) ?? 'undated'}) → ${conflict.later?.value ?? 'withdrawn'} (${conflict.later?.at?.slice(0, 10) ?? 'undated'})`).join('; ')}
                </span>
              )}
              {!!discovery.unanswered?.length && (
                <span class="awv2-brain-muted">Still unanswered: {discovery.unanswered.map((dimension) => DIMENSION_LABEL[dimension] ?? dimension).join(', ')}</span>
              )}
            </div>
          )}
          {!!discovery.refusals?.some((refusal) => refusal.excerpt) && (
            <details class="awv2-brain-history" data-testid="seller-discovery-refusals">
              <summary>Refused as seller claims ({discovery.refusals.filter((refusal) => refusal.excerpt).length})</summary>
              <ul>
                {discovery.refusals.filter((refusal) => refusal.excerpt).map((refusal) => (
                  <li><b>{refusal.record}</b> “{refusal.excerpt}” <span class="awv2-brain-muted">— {refusal.reason}</span></li>
                ))}
              </ul>
            </details>
          )}

          <div class="awv2-brain-discovery-brief" data-testid="seller-discovery-brief">
            <small>Discovery brief · {open.length} open question(s)</small>
            <p class="awv2-brain-discovery-objective">{discovery.brief.objective}</p>
            <ol>
              {open.map((question) => (
                <li data-priority={question.priority} data-key={question.key}>
                  <b>{question.question}</b>
                  <span>{question.why}</span>
                  <span class="awv2-brain-muted">Raised by: {question.basis}</span>
                </li>
              ))}
            </ol>
            {!!answered.length && (
              <details>
                <summary>Answered by the seller ({answered.length})</summary>
                <ul>{answered.map((question) => <li><b>{question.topic}</b> {question.question}</li>)}</ul>
              </details>
            )}
            {!!discovery.brief.doNotAssume?.length && (
              <div class="awv2-brain-discovery-guard">
                <small>Do not assume on the call</small>
                <ul>{discovery.brief.doNotAssume.map((entry) => <li>{entry}</li>)}</ul>
              </div>
            )}
          </div>

          {!!discovery.operatorProfileNotes?.length && (
            <div class="awv2-brain-muted" data-testid="seller-discovery-profile-notes">
              Operator profile notes (not seller claims): {discovery.operatorProfileNotes.map((note) => `${words(note.field)}: ${note.value}`).join('; ')}
            </div>
          )}
          {!!discovery.limitations?.length && (
            <ul class="awv2-brain-discovery-limits">{discovery.limitations.map((entry) => <li>{entry}</li>)}</ul>
          )}
        </>
      )}
    </section>
  );
}
