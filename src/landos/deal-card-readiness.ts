// LandOS — Deal Card DD readiness (pure, derived from the persisted report).
//
// Turns a DealCardReportView into an at-a-glance operational picture for the
// pre-call Due Diligence Command Center: discovery-report state, the single
// next-best action, completeness, top missing facts, top risks, and provider
// provenance. Pure + deterministic; no DB, no network, no fabrication.

import type { DealCardReportView } from './deal-card-report.js';
import type { SellerFactsSummary } from './seller-stated-facts.js';

export type DiscoveryReportState = 'not_generated' | 'generated' | 'stale' | 'needs_rerun';

export type WorkflowStage =
  | 'pre_discovery_ready'
  | 'discovery_completed'
  | 'needs_deeper_dd'
  | 'county_verification_needed'
  | 'underwriting_ready'
  | 'offer_prep_ready';

const STAGE_LABEL: Record<WorkflowStage, string> = {
  pre_discovery_ready: 'Pre-discovery ready',
  discovery_completed: 'Discovery completed',
  needs_deeper_dd: 'Needs deeper DD',
  county_verification_needed: 'County verification needed',
  underwriting_ready: 'Underwriting ready',
  offer_prep_ready: 'Offer prep ready',
};

export type NextBestActionKind =
  | 'ready_for_discovery_call'
  | 'needs_parcel_verification'
  | 'needs_dd_facts'
  | 'needs_market_comps'
  | 'needs_visual_capture'
  | 'needs_county_verification';

const ACTION_LABEL: Record<NextBestActionKind, string> = {
  ready_for_discovery_call: 'Ready for discovery call',
  needs_parcel_verification: 'Verify parcel identity',
  needs_dd_facts: 'Gather Due Diligence facts',
  needs_market_comps: 'Add market / comps research',
  needs_visual_capture: 'Capture property visuals',
  needs_county_verification: 'Confirm with county records',
};

export interface DealCardReadiness {
  discoveryReportState: DiscoveryReportState;
  workflowStage: WorkflowStage;
  workflowStageLabel: string;
  nextBestAction: { action: NextBestActionKind; label: string; reason: string };
  ddCompleteness: { verified: number; total: number; percentComplete: number; label: string };
  topMissingDdFacts: string[];
  topRiskFlags: string[];
  providerProvenance: { parcelSource: string; parcelStatus: string; parcelVerified: boolean };
  visualsCaptured: number;
  /** Count of seller-stated facts captured post-discovery. */
  sellerFactCount: number;
}

function workflowStage(
  report: DealCardReportView,
  opts: { sellerFacts?: SellerFactsSummary; hasCountyVerification?: boolean },
): WorkflowStage {
  if (!report.exists || !report.parcelVerified) return 'pre_discovery_ready';
  const discoveryDone = opts.sellerFacts?.discoveryCaptured ?? false;
  if (!discoveryDone) return 'pre_discovery_ready';
  // Post-discovery progression.
  const hasCounty = opts.hasCountyVerification ?? false;
  if (report.countyVerificationChecklist.length > 0 && !hasCounty) return 'county_verification_needed';
  const missingFacts = report.ddFactChecklist.some((r) => r.status === 'needs_verification' && !r.noConnectedSource);
  if (missingFacts) return 'needs_deeper_dd';
  // Facts in hand + county done -> underwriting/offer prep.
  if (report.offerReadiness === 'ready_for_offer') return 'offer_prep_ready';
  return discoveryDone ? 'underwriting_ready' : 'discovery_completed';
}

function discoveryReportState(report: DealCardReportView, dealUpdatedAt?: number): DiscoveryReportState {
  if (!report.exists) return 'not_generated';
  if (report.reportStatus === 'failed' || report.reportStatus === 'blocked') return 'needs_rerun';
  // Stale: the Deal Card changed after the report was generated.
  if (typeof dealUpdatedAt === 'number' && typeof report.generatedAt === 'number' && dealUpdatedAt > report.generatedAt) {
    return 'stale';
  }
  return 'generated';
}

function nextBestAction(report: DealCardReportView, visualsCaptured: number): DealCardReadiness['nextBestAction'] {
  const mk = (action: NextBestActionKind, reason: string) => ({ action, label: ACTION_LABEL[action], reason });
  if (!report.parcelVerified) {
    return mk('needs_parcel_verification', 'Parcel identity is not verified — verify before any scoring, valuation, or offer.');
  }
  if (report.ddCompleteness.verified === 0) {
    return mk('needs_dd_facts', 'Parcel verified but no DD facts captured yet — gather acreage/zoning and core facts.');
  }
  const marketGap =
    report.dataGaps.some((g) => /market|demand|comp/i.test(g)) ||
    /not yet defined|not eligible/i.test(report.marketSummary);
  if (marketGap) {
    return mk('needs_market_comps', 'Local market / comps not yet researched — add market pulse and comparable context.');
  }
  if (visualsCaptured === 0) {
    return mk('needs_visual_capture', 'No property visuals captured — capture satellite/Street View for call context.');
  }
  if (report.countyVerificationChecklist.length > 0) {
    return mk('needs_county_verification', 'Confirm zoning/access/utilities/flood with official county records before the call.');
  }
  return mk('ready_for_discovery_call', 'Parcel verified, DD facts present, market reviewed, visuals captured — ready for the discovery call.');
}

export interface ReadinessOpts {
  dealUpdatedAt?: number;
  /** Seller-stated facts summary (post-discovery). Affects stage + risk flags. */
  sellerFacts?: SellerFactsSummary;
  /** Whether any county verification result has been recorded for this deal. */
  hasCountyVerification?: boolean;
}

/** Compute the at-a-glance readiness for a Deal Card from its persisted report
 *  (+ optional post-discovery seller facts / county verification signals). */
export function computeDealCardReadiness(report: DealCardReportView, opts: ReadinessOpts = {}): DealCardReadiness {
  const visualsCaptured = report.visualContext.assets.filter((a) => a.status === 'captured').length;
  const parcelRow = report.sourceTable.find((r) => r.kind === 'parcel_exact');
  const topMissingDdFacts = report.ddFactChecklist
    .filter((r) => r.status === 'needs_verification' && !r.noConnectedSource)
    .map((r) => r.label)
    .slice(0, 5);
  // Risk flags combine report risks with seller-stated risk flags (each labeled).
  const topRiskFlags = [...report.riskFlags, ...(opts.sellerFacts?.riskFlags ?? [])].slice(0, 5);
  const stage = workflowStage(report, opts);
  return {
    discoveryReportState: discoveryReportState(report, opts.dealUpdatedAt),
    workflowStage: stage,
    workflowStageLabel: STAGE_LABEL[stage],
    nextBestAction: nextBestAction(report, visualsCaptured),
    ddCompleteness: {
      verified: report.ddCompleteness.verified,
      total: report.ddCompleteness.total,
      percentComplete: report.ddCompleteness.percentComplete,
      label: report.ddCompleteness.label,
    },
    topMissingDdFacts,
    topRiskFlags,
    providerProvenance: {
      parcelSource: parcelRow?.source ?? 'No parcel provider used',
      parcelStatus: report.parcelVerificationStatus,
      parcelVerified: report.parcelVerified,
    },
    visualsCaptured,
    sellerFactCount: opts.sellerFacts?.count ?? 0,
  };
}
