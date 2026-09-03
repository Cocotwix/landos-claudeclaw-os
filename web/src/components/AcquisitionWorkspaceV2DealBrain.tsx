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

// ── Stage 5: the Development Path and the strategy comparison ─────────────

export interface DevelopmentSourceView {
  label?: string; url?: string | null; tier?: string; effectiveOrAsOf?: string | null; retrievedAt?: string | null;
  section?: string | null; excerpt?: string | null; carries?: string;
}

export interface DevelopmentPathItemView {
  kind?: string; label?: string;
  localDefinition?: { term?: string; definition?: string; section?: string | null; source?: DevelopmentSourceView } | null;
  trigger?: string;
  threshold?: { statement?: string; maxLots?: number | null; basis?: string };
  authority?: string | null; reviewBody?: string | null;
  materials?: Array<{ item?: string; requirement?: string; section?: string | null }>;
  requirements?: Array<{ kind?: string; requirement?: string; section?: string | null; source?: string | null }>;
  approvalSteps?: string[]; parcelGates?: string[];
  applicability?: string; applicabilityWhy?: string; weight?: string;
  costAndTime?: { estimatedCost?: string | null; estimatedTime?: string | null; basis?: string } | null;
  missingInputs?: string[];
  decisiveVerification?: { action?: string; why?: string; askOf?: string | null };
  sources?: DevelopmentSourceView[];
}

export interface DevelopmentPathView {
  correlation?: string;
  retainedAt?: string | null;
  snapshotId?: number | null;
  contractVersion?: string;
  confidence?: string;
  subject?: { apn?: string | null; county?: string | null; state?: string | null; acres?: number | null; subjectVersion?: string | null };
  authority?: {
    state?: string | null; county?: string | null; municipalityOrTownship?: string | null; incorporationStatus?: string;
    zoning?: { name?: string | null; level?: string; weight?: string; basis?: string };
    subdivision?: { name?: string | null; level?: string; weight?: string; basis?: string };
    planningBody?: string | null;
    etjOrPlanningArea?: { status?: string; statement?: string };
    specialAuthorities?: string[];
    boundaryEvidence?: { sourceLabel?: string; incorporationStatus?: string; controllingAuthorityName?: string | null; mailingCityDiffersFromAuthority?: boolean; basis?: string } | null;
    conflict?: { statement?: string; sides?: Array<{ claim?: string; source?: string; url?: string | null; retrievedAt?: string | null; applicability?: string; weight?: string }>; decisiveVerification?: string } | null;
    nonQualifyingClaims?: Array<{ claim?: string; level?: string; source?: string; url?: string | null; retrievedAt?: string | null; reason?: string }>;
    postalLocality?: { city?: string | null; statement?: string };
    sources?: DevelopmentSourceView[];
  };
  zoning?: {
    established?: boolean; districtCode?: string | null; districtName?: string | null; overlays?: string[]; evidenceKind?: string | null;
    parcelMatchBasis?: string | null; effectiveOrAsOf?: string | null; weight?: string; statement?: string; source?: DevelopmentSourceView | null;
    historicalReferences?: Array<{ kind?: string | null; value?: string | null; asOf?: string | null }>; limitations?: string[];
  };
  uses?: Array<{ key?: string; label?: string; standing?: string; finding?: string | null; section?: string | null; source?: DevelopmentSourceView | null; strategies?: string[]; statement?: string }>;
  standards?: Array<{ key?: string; label?: string; status?: string; value?: string | null; section?: string | null; source?: DevelopmentSourceView | null; gap?: string | null }>;
  subjectScreen?: {
    acres?: number | null; frontageFt?: number | null; roadName?: string | null; accessEstablished?: boolean; accessStatement?: string;
    wetlandsPct?: number | null; floodZone?: string | null; wellSepticStatus?: string; utilitiesStatus?: string; minimumLotAcres?: number | null;
    theoreticalLotCount?: { value?: number | null; calculation?: string; approvedYield?: false };
    frontageCeiling?: { status?: string; maxLots?: number | null; detail?: string };
    statements?: string[];
  };
  paths?: DevelopmentPathItemView[];
  criticalGates?: Array<{ key?: string; gate?: string; why?: string; decisiveVerification?: string; blocks?: string[]; weight?: string }>;
  unknowns?: string[];
  sourceLineage?: DevelopmentSourceView[];
  currentness?: { effectiveDates?: Array<{ source?: string; date?: string }>; latestRetrievedAt?: string | null; statement?: string; refreshOn?: string[] };
  limitations?: string[];
  inputStatus?: Record<string, string>;
  basedOn?: Record<string, number | string | null>;
  refresh?: { cause?: string; kind?: string; changes?: Array<{ dimension?: string; before?: string | null; after?: string }>; priorSnapshotId?: number | null };
}

export interface DevelopmentPathHistoryView {
  snapshotId?: number; version?: number; retainedAt?: string | null; authority?: string | null; district?: string | null;
  paths?: Record<string, string>; refresh?: { cause?: string; kind?: string; changes?: Array<{ dimension?: string }> };
}

export interface CostLineView { key?: string; label?: string; amount?: number | null; basis?: string; source?: string }

export interface ExitScenarioView {
  /** Preliminary Land Home Package posture; present only on the land-home scenario. */
  landHomePosture?: 'WORTH EXPLORING' | 'MARGINAL' | 'NOT VIABLE' | null;
  id?: string; label?: string; strategyId?: string | null; pathKind?: string | null; subjectScope?: string;
  status?: string; confidence?: string; statusWhy?: string;
  grossExit?: { amount?: number; basis?: string; asOf?: string | null } | null;
  purchasePriceCapacity?: { low?: number; high?: number; lowPct?: number; highPct?: number; basis?: string; confirmed?: boolean } | null;
  directCosts?: CostLineView[]; softCosts?: CostLineView[];
  capitalAtRisk?: { amount?: number; basis?: string } | null;
  timeToExit?: { statement?: string; basis?: string } | null;
  keyApprovals?: string[];
  returnMetrics?: { purchasePrice?: number; purchasePriceBasis?: string; totalCost?: number; netProfit?: number; returnOnCapital?: number; minimumNet?: number; meetsMinimumNet?: boolean; basis?: string } | null;
  missingInputs?: string[]; complexity?: string; buyerDemand?: string; risks?: string[]; nextDecisiveAction?: string;
}

export interface StrategyComparisonView {
  developmentPathStatus?: string;
  scenarios?: ExitScenarioView[];
  priceSensitivity?: {
    mode?: string; source?: string | null;
    points?: Array<{ label?: string; price?: number; plausible?: string[]; undetermined?: string[]; exceeded?: string[]; statement?: string }>;
    statement?: string; missingInputs?: string[];
  };
  ranking?: Array<{ id?: string; rank?: number; why?: string }>;
  criteria?: string[];
  statement?: string;
  notAutoSelected?: boolean;
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
  inputs?: { property?: Stage3StatusView | null; market?: Stage3StatusView | null; developmentPath?: Stage3StatusView | null } | null;
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
  strategyComparison?: StrategyComparisonView | null;
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
  basedOn?: { propertySnapshotId?: number | null; marketSnapshotId?: number | null; developmentPathSnapshotId?: number | null; subjectVersion?: string | null };
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
  viable: 'green', applies: 'green', may_apply: 'yellow', not_applicable: 'red', not_established: 'grey',
  by_right: 'green', prohibited: 'red', established: 'green',
};

const USE_STANDING_LABEL: Record<string, string> = {
  by_right: 'By right', conditional: 'Conditional / special exception', prohibited: 'Prohibited', not_established: 'Not established',
};
const APPLICABILITY_LABEL: Record<string, string> = {
  applies: 'Applies', may_apply: 'May apply', not_applicable: 'Not applicable', not_established: 'Not established',
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

export function DealBrainDecisionPanel({ decision, stability, history, stage3, sellerReadStatus, developmentPath }: {
  decision: DealDecisionView | null | undefined;
  stability?: DecisionStabilityView | null;
  history?: DealDecisionHistoryView[] | null;
  /** The live shared Stage 3 status (same rows, same mapping as the score cards). */
  stage3?: { property?: Stage3StatusView | null; market?: Stage3StatusView | null } | null;
  sellerReadStatus?: SellerReadStatusView | null;
  /** Stage 5: the retained Development Path and its live status. */
  developmentPath?: { path: DevelopmentPathView | null; status: Stage3StatusView | null; history: DevelopmentPathHistoryView[] } | null;
}) {
  const subject = decision?.subject;
  const value = decision?.value;
  const seller = decision?.seller;
  const changes = decision?.refresh?.changes ?? [];
  // The live status wins; the status the decision recorded is the fallback.
  const propertyInput = stage3?.property ?? decision?.inputs?.property ?? null;
  const marketInput = stage3?.market ?? decision?.inputs?.market ?? null;
  const pathInput = developmentPath?.status ?? decision?.inputs?.developmentPath ?? null;
  const path = developmentPath?.path?.correlation === 'equivalent' ? developmentPath.path : null;
  const comparison = decision?.strategyComparison ?? null;
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
                  <b>Combined LandOS FMV {usd(value.fmv?.central)}</b>
                  <span>{(value.acceptedCompCount ?? 0) > 0
                    ? `${value.acceptedCompCount} qualified closed sale${value.acceptedCompCount === 1 ? '' : 's'} in the valuation set`
                    : 'No qualified non-LandPortal closed sale yet; the value rests on the LandPortal lane and retained market evidence'}</span>
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

          <DevelopmentPathSection path={path} status={pathInput} history={developmentPath?.history ?? []} retained={developmentPath?.path ?? null} />

          {comparison && <StrategyComparisonSection comparison={comparison} />}

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

// ── Stage 5: Development Path ──────────────────────────────────────────────

function SourceLine({ source }: { source: DevelopmentSourceView | null | undefined }) {
  if (!source) return null;
  return (
    <span class="awv2-brain-muted awv2-dev-source">
      {source.url ? <a href={source.url} target="_blank" rel="noreferrer">{source.label}</a> : source.label}
      {source.section ? ` · ${source.section}` : ''}
      {source.effectiveOrAsOf ? ` · as of ${source.effectiveOrAsOf}` : ''}
      {source.tier ? ` · ${words(source.tier)}` : ''}
    </span>
  );
}

function DevelopmentPathSection({ path, status, history, retained }: {
  path: DevelopmentPathView | null;
  status: Stage3StatusView | null;
  history: DevelopmentPathHistoryView[];
  retained: DevelopmentPathView | null;
}) {
  const authority = path?.authority;
  return (
    <div class="awv2-brain-devpath" data-testid="deal-decision-development-path" data-status={status?.status ?? undefined} data-snapshot-id={status?.snapshotId ?? undefined}>
      <small>Development Path — the local jurisdiction's rules applied to this parcel</small>
      {status && (
        <span class="awv2-brain-muted" data-testid="deal-decision-development-path-status">
          {stage3Lineage(status)}{status.consumedByDealBrain ? ' · consumed by this decision' : ''}
        </span>
      )}
      {!path && (
        <p class="awv2-pi-note" data-testid="deal-decision-development-path-pending">
          {retained && retained.correlation !== 'equivalent'
            ? 'The retained Development Path answered about another parcel version; it is history, and the current path is pending.'
            : 'The Development Path is pending: LandOS applies the local zoning and subdivision rules the moment the Property Story settles.'}
        </p>
      )}
      {path && (
        <>
          <div class="awv2-brain-grid">
            <div class="awv2-brain-block" data-testid="deal-decision-governing-authority" data-conflict={String(!!authority?.conflict)}>
              <small>Governing authority</small>
              <b>{authority?.zoning?.name ?? 'Not established'}{authority?.zoning?.level ? ` · ${words(authority.zoning.level)}` : ''}{authority?.zoning?.weight ? ` · ${words(authority.zoning.weight)}` : ''}</b>
              <span>{[authority?.state, authority?.county, authority?.municipalityOrTownship].filter(Boolean).join(' · ')} · {words(authority?.incorporationStatus)}</span>
              <span class="awv2-brain-muted">{authority?.zoning?.basis}</span>
              {authority?.subdivision?.name && authority.subdivision.name !== authority.zoning?.name && (
                <span class="awv2-brain-muted">Subdivision authority: {authority.subdivision.name} ({words(authority.subdivision.weight)}).</span>
              )}
              {authority?.planningBody && <span class="awv2-brain-muted">Planning body: {authority.planningBody}</span>}
              <span class="awv2-brain-muted">ETJ / planning area: {authority?.etjOrPlanningArea?.statement}</span>
              {!!authority?.specialAuthorities?.length && (
                <span class="awv2-brain-muted">Special authorities referenced: {authority.specialAuthorities.join(' · ')}</span>
              )}
              {authority?.conflict && (
                <div class="awv2-dev-conflict" data-testid="deal-decision-authority-conflict">
                  <b>Authority conflict</b>
                  <span>{authority.conflict.statement}</span>
                  <ul>{(authority.conflict.sides ?? []).map((side) => (
                    <li><b>{side.claim}</b> — {side.url ? <a href={side.url} target="_blank" rel="noreferrer">{side.source}</a> : side.source}{side.retrievedAt ? ` · retrieved ${side.retrievedAt.slice(0, 10)}` : ''}{side.applicability ? ` · ${side.applicability}` : ''} ({side.weight})</li>
                  ))}</ul>
                  <span><i>Decisive verification:</i> {authority.conflict.decisiveVerification}</span>
                </div>
              )}
              {!!authority?.nonQualifyingClaims?.length && (
                <div class="awv2-dev-nonqualifying" data-testid="deal-decision-authority-non-qualifying">
                  <b>Retained claims that do not qualify at parcel level</b>
                  <ul>{authority.nonQualifyingClaims.map((claim) => (
                    <li><b>{claim.claim}</b> — {claim.url ? <a href={claim.url} target="_blank" rel="noreferrer">{claim.source}</a> : claim.source}{claim.retrievedAt ? ` · retrieved ${claim.retrievedAt.slice(0, 10)}` : ''}. {claim.reason}</li>
                  ))}</ul>
                </div>
              )}
              {authority?.postalLocality?.statement && <span class="awv2-brain-muted" data-testid="deal-decision-postal-locality">{authority.postalLocality.statement}</span>}
              {(authority?.sources ?? []).slice(0, 3).map((source) => <SourceLine source={source} />)}
            </div>

            <div class="awv2-brain-block" data-testid="deal-decision-current-zoning" data-established={String(!!path.zoning?.established)}>
              <small>Current zoning</small>
              <b>{path.zoning?.established ? `${path.zoning.districtCode}${path.zoning.districtName ? ` · ${path.zoning.districtName}` : ''}` : 'District not established'}{path.zoning?.weight ? ` · ${words(path.zoning.weight)}` : ''}</b>
              <span>{path.zoning?.statement}</span>
              {!!path.zoning?.overlays?.length && <span class="awv2-brain-muted">Overlays: {path.zoning.overlays.join(', ')}</span>}
              <SourceLine source={path.zoning?.source} />
              {!!path.zoning?.historicalReferences?.length && (
                <span class="awv2-brain-muted">Historical references (never the current district): {path.zoning.historicalReferences.map((ref) => `${ref.value ?? ref.kind ?? '?'}${ref.asOf ? ` (${ref.asOf})` : ''}`).join('; ')}</span>
              )}
            </div>

            <div class="awv2-brain-block" data-testid="deal-decision-subject-screen">
              <small>Subject screen</small>
              <ul class="awv2-brain-caveats">{(path.subjectScreen?.statements ?? []).map((line) => <li>{line}</li>)}</ul>
              <span class="awv2-brain-muted">Well/septic: {path.subjectScreen?.wellSepticStatus} · Utilities: {path.subjectScreen?.utilitiesStatus}</span>
            </div>
          </div>

          <div class="awv2-dev-uses" data-testid="deal-decision-uses">
            <small>Uses relevant to company strategies — by right, conditional, prohibited, or not established</small>
            <div class="awv2-brain-evidence-grid">
              {(path.uses ?? []).map((use) => (
                <div class="awv2-brain-evidence-row" data-standing={use.standing} data-tone={STATUS_TONE[use.standing ?? ''] ?? 'grey'}>
                  <b>{use.label}</b>
                  <span class="awv2-brain-evidence-status">{USE_STANDING_LABEL[use.standing ?? ''] ?? words(use.standing)}</span>
                  <span>{use.statement}</span>
                  <SourceLine source={use.source} />
                </div>
              ))}
            </div>
          </div>

          <div class="awv2-dev-standards" data-testid="deal-decision-standards">
            <small>Dimensional standards — each traced to its section</small>
            <div class="awv2-brain-evidence-grid">
              {(path.standards ?? []).map((row) => (
                <div class="awv2-brain-evidence-row" data-key={row.key} data-tone={row.status === 'established' ? 'green' : 'grey'}>
                  <b>{row.label}</b>
                  <span class="awv2-brain-evidence-status">{words(row.status)}</span>
                  <span>{row.value ?? row.gap}</span>
                  <SourceLine source={row.source} />
                </div>
              ))}
            </div>
          </div>

          <div class="awv2-dev-paths" data-testid="deal-decision-paths">
            <small>Paths — in the jurisdiction's own words; cost and time only when a source or the operator states them</small>
            <div class="awv2-brain-strategy-grid">
              {(path.paths ?? []).map((item) => (
                <div class="awv2-brain-strategy awv2-dev-path" data-path={item.kind} data-applicability={item.applicability} data-tone={STATUS_TONE[item.applicability ?? ''] ?? 'grey'}>
                  <b>{item.label}</b>
                  <span class="awv2-brain-strategy-status">{APPLICABILITY_LABEL[item.applicability ?? ''] ?? words(item.applicability)} · {words(item.weight)}</span>
                  <span>{item.applicabilityWhy}</span>
                  {item.localDefinition && (
                    <span class="awv2-dev-local"><i>Local definition ({item.localDefinition.term}{item.localDefinition.section ? `, ${item.localDefinition.section}` : ''}):</i> "{item.localDefinition.definition}"</span>
                  )}
                  <span><i>Trigger:</i> {item.trigger}</span>
                  <span><i>Threshold:</i> {item.threshold?.statement}</span>
                  <span><i>Authority / review body:</i> {item.authority ?? 'not established'}{item.reviewBody ? ` · ${item.reviewBody}` : ''}</span>
                  {!!item.materials?.length && <span><i>Materials:</i> {item.materials.map((m) => `${m.item}: ${m.requirement}`).join(' · ')}</span>}
                  {!!item.requirements?.length && (
                    <ul class="awv2-brain-caveats">{item.requirements.map((req) => <li><b>{words(req.kind)}</b> {req.requirement}{req.section ? ` (${req.section})` : ''}</li>)}</ul>
                  )}
                  {!!item.approvalSteps?.length && <span><i>Approval steps:</i> {item.approvalSteps.join(' → ')}</span>}
                  {!!item.parcelGates?.length && <span><i>Parcel gates:</i> {item.parcelGates.join(' ')}</span>}
                  <span data-testid={`deal-decision-path-cost-${item.kind}`}><i>Cost / time:</i> {item.costAndTime ? `${item.costAndTime.estimatedCost ?? 'cost not stated'} · ${item.costAndTime.estimatedTime ?? 'time not stated'} (${item.costAndTime.basis})` : 'Not sourced: no retained source or operator figure states cost or time for this path.'}</span>
                  {!!item.missingInputs?.length && <span class="awv2-brain-muted"><i>Missing inputs:</i> {item.missingInputs.join(' ')}</span>}
                  <span class="awv2-dev-verify" data-testid={`deal-decision-path-verify-${item.kind}`}><i>Smallest decisive verification:</i> {item.decisiveVerification?.action}{item.decisiveVerification?.askOf ? ` (ask: ${item.decisiveVerification.askOf})` : ''} — {item.decisiveVerification?.why}</span>
                  {(item.sources ?? []).slice(0, 3).map((source) => <SourceLine source={source} />)}
                </div>
              ))}
            </div>
          </div>

          <div class="awv2-brain-columns">
            <div data-testid="deal-decision-critical-gates">
              <small>Critical gates — what must be verified before an approval, price or strategy conclusion can be trusted</small>
              <ol>
                {(path.criticalGates ?? []).map((gate) => (
                  <li data-gate={gate.key}>
                    <b>{gate.gate}</b> {gate.why}
                    <span class="awv2-brain-muted"> Blocks: {(gate.blocks ?? []).map(words).join(', ')}. Verify: {gate.decisiveVerification}</span>
                  </li>
                ))}
              </ol>
              {!path.criticalGates?.length && <span class="awv2-brain-muted">No critical gate is open.</span>}
            </div>
            <div data-testid="deal-decision-unknowns">
              <small>Unknowns</small>
              <ul>{(path.unknowns ?? []).map((line) => <li>{line}</li>)}</ul>
            </div>
          </div>

          <details class="awv2-brain-history" data-testid="deal-decision-source-lineage">
            <summary>Source lineage ({path.sourceLineage?.length ?? 0}) · {path.currentness?.statement}</summary>
            <ul>
              {(path.sourceLineage ?? []).map((source) => (
                <li>
                  {source.url ? <a href={source.url} target="_blank" rel="noreferrer">{source.label}</a> : source.label}
                  {source.section ? ` · ${source.section}` : ''} · {words(source.tier)}{source.effectiveOrAsOf ? ` · as of ${source.effectiveOrAsOf}` : ''}{source.retrievedAt ? ` · retrieved ${source.retrievedAt.slice(0, 10)}` : ''} — {source.carries}
                  {source.excerpt && <span class="awv2-brain-muted"> "{source.excerpt}"</span>}
                </li>
              ))}
            </ul>
            <span class="awv2-brain-muted">Refreshes on: {(path.currentness?.refreshOn ?? []).join(' ')}</span>
          </details>

          <div class="awv2-brain-refresh" data-testid="deal-decision-development-path-refresh" data-kind={path.refresh?.kind}>
            <span>
              {path.refresh?.kind === 'material'
                ? `Development Path refreshed by ${words(path.refresh?.cause)}: ${path.refresh?.changes?.length ?? 0} material dimension(s) moved.`
                : path.refresh?.kind === 'contract'
                  ? `Development Path re-formed under the current contract by ${words(path.refresh?.cause)}.`
                  : `Initial Development Path, formed by ${words(path.refresh?.cause)}.`}
              {path.retainedAt ? ` Retained ${when(path.retainedAt)}.` : ''} Confidence: {words(path.confidence)}.
            </span>
            {!!path.refresh?.changes?.length && (
              <ul class="awv2-brain-changes">
                {path.refresh.changes.map((change) => <li><b>{words(change.dimension)}</b> {change.before ?? 'unknown'} → {change.after}</li>)}
              </ul>
            )}
            {!!history.length && (
              <details class="awv2-brain-history" data-testid="deal-decision-development-path-history">
                <summary>Prior Development Paths ({history.length})</summary>
                <ul>
                  {history.map((entry) => (
                    <li><b>{entry.authority ?? 'authority unresolved'} · {entry.district ?? 'district not established'}</b> {Object.entries(entry.paths ?? {}).map(([kind, applicability]) => `${words(kind)}: ${words(applicability)}`).join(' · ')}
                      <span class="awv2-brain-muted"> — {words(entry.refresh?.kind)} by {words(entry.refresh?.cause)}{entry.retainedAt ? ` · ${when(entry.retainedAt)}` : ''}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
          {!!path.limitations?.length && (
            <ul class="awv2-brain-limits" data-testid="deal-decision-development-path-limitations">{path.limitations.map((line) => <li>{line}</li>)}</ul>
          )}
        </>
      )}
    </div>
  );
}

// ── Stage 5: strategy comparison ───────────────────────────────────────────

function CostLines({ lines }: { lines: CostLineView[] | undefined }) {
  if (!lines?.length) return null;
  return (
    <ul class="awv2-brain-caveats">
      {lines.map((line) => (
        <li data-source={line.source}>
          <b>{line.label}:</b> {line.amount != null ? usd(line.amount) : 'missing'} <span class="awv2-brain-muted">({line.basis}{line.source ? ` · ${words(line.source)}` : ''})</span>
        </li>
      ))}
    </ul>
  );
}

function StrategyComparisonSection({ comparison }: { comparison: StrategyComparisonView }) {
  const sensitivity = comparison.priceSensitivity;
  const rankOf = (id: string | undefined) => comparison.ranking?.find((entry) => entry.id === id)?.rank;
  const scenarios = [...(comparison.scenarios ?? [])].sort((a, b) => (rankOf(a.id) ?? 99) - (rankOf(b.id) ?? 99));
  return (
    <div class="awv2-brain-comparison" data-testid="deal-decision-strategy-comparison" data-development-path={comparison.developmentPathStatus}>
      <small>Strategy comparison — every relevant exit, side by side; nothing is auto-selected</small>
      <p class="awv2-dev-comparison-statement" data-testid="deal-decision-comparison-statement">{comparison.statement}</p>
      <span class="awv2-brain-muted">Criteria: {(comparison.criteria ?? []).join(' · ')}</span>

      <div class="awv2-dev-sensitivity" data-testid="deal-decision-price-sensitivity" data-mode={sensitivity?.mode}>
        <b>Seller price as a sensitivity: {words(sensitivity?.mode)}</b>
        <span>{sensitivity?.statement}</span>
        {sensitivity?.source && <span class="awv2-brain-muted">Source: {sensitivity.source}</span>}
        {!!sensitivity?.points?.length && (
          <table class="awv2-dev-table">
            <thead><tr><th>Point</th><th>Price</th><th>Still plausible</th><th>Exceeded</th><th>No capacity yet</th></tr></thead>
            <tbody>
              {sensitivity.points.map((point) => (
                <tr data-point={point.label}>
                  <td>{point.label}</td>
                  <td>{usd(point.price)}</td>
                  <td>{(point.plausible ?? []).map(words).join(', ') || '—'}</td>
                  <td>{(point.exceeded ?? []).map(words).join(', ') || '—'}</td>
                  <td>{(point.undetermined ?? []).map(words).join(', ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!!sensitivity?.missingInputs?.length && (
          <span class="awv2-brain-muted" data-testid="deal-decision-sensitivity-missing">Missing value or cost inputs: {sensitivity.missingInputs.join(' ')}</span>
        )}
      </div>

      <div class="awv2-brain-strategy-grid awv2-dev-scenarios">
        {scenarios.map((scenario) => (
          <div class="awv2-brain-strategy awv2-dev-scenario" data-scenario={scenario.id} data-status={scenario.status} data-tone={STATUS_TONE[scenario.status ?? ''] ?? 'grey'}>
            <b>#{rankOf(scenario.id)} {scenario.label}</b>
            <span class="awv2-brain-strategy-status">{words(scenario.status)} · {words(scenario.confidence)} · {scenario.complexity} complexity</span>
            {scenario.id === 'land_home_manufactured' && (
              <span class="awv2-brain-strategy-status" data-testid="deal-decision-land-home-posture" data-posture={scenario.landHomePosture ?? 'UNSCREENED'}>
                <b>Preliminary Land Home Package: {scenario.landHomePosture ?? 'UNSCREENED'}</b>
                {' · '}{(scenario.statusWhy ?? '').replace(/^Preliminary Land Home Package posture: [^.]*\. /, '').split(' Next verification: ')[0]}
                {(scenario.statusWhy ?? '').includes(' Next verification: ') ? ` · Next: ${(scenario.statusWhy ?? '').split(' Next verification: ')[1]}` : ''}
              </span>
            )}
            {scenario.id !== 'land_home_manufactured' && <span>{scenario.statusWhy}</span>}
            <span><i>Scope:</i> {scenario.subjectScope}</span>
            <span><i>Gross exit:</i> {scenario.grossExit ? `${usd(scenario.grossExit.amount)} (${scenario.grossExit.basis}${scenario.grossExit.asOf ? `, as of ${scenario.grossExit.asOf}` : ''})` : 'not sourced'}</span>
            <span><i>Purchase-price capacity:</i> {scenario.purchasePriceCapacity ? `${usd(scenario.purchasePriceCapacity.low)}–${usd(scenario.purchasePriceCapacity.high)} (${scenario.purchasePriceCapacity.basis}${scenario.purchasePriceCapacity.confirmed ? '' : '; draft'})` : 'not computable'}</span>
            <span><i>Direct costs:</i></span><CostLines lines={scenario.directCosts} />
            <span><i>Soft costs:</i></span><CostLines lines={scenario.softCosts} />
            <span><i>Capital at risk:</i> {scenario.capitalAtRisk ? `${usd(scenario.capitalAtRisk.amount)} (${scenario.capitalAtRisk.basis})` : 'not computable'}</span>
            <span><i>Time to exit:</i> {scenario.timeToExit ? `${scenario.timeToExit.statement} (${scenario.timeToExit.basis})` : 'not sourced'}</span>
            <span><i>Key approvals:</i> {(scenario.keyApprovals ?? []).join(' → ') || 'none'}</span>
            <span data-testid={`deal-decision-scenario-return-${scenario.id}`}><i>Expected return:</i> {scenario.returnMetrics
              ? `net ${usd(scenario.returnMetrics.netProfit)} on ${usd(scenario.returnMetrics.purchasePrice)} (${Math.round((scenario.returnMetrics.returnOnCapital ?? 0) * 100)}% on capital; ${scenario.returnMetrics.meetsMinimumNet ? 'meets' : 'below'} the ${usd(scenario.returnMetrics.minimumNet)} minimum net). ${scenario.returnMetrics.basis}`
              : `withheld: ${scenario.missingInputs?.length ?? 0} input(s) not visible.`}</span>
            {!!scenario.missingInputs?.length && <span class="awv2-brain-muted"><i>Missing inputs:</i> {scenario.missingInputs.join(' ')}</span>}
            <span class="awv2-brain-muted"><i>Buyer demand:</i> {scenario.buyerDemand}</span>
            {!!scenario.risks?.length && <span class="awv2-brain-muted"><i>Risks / gates:</i> {scenario.risks.join(' · ')}</span>}
            <span class="awv2-dev-verify"><i>Next decisive action:</i> {scenario.nextDecisiveAction}</span>
            <span class="awv2-brain-muted"><i>Rank basis:</i> {comparison.ranking?.find((entry) => entry.id === scenario.id)?.why}</span>
          </div>
        ))}
      </div>
    </div>
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
