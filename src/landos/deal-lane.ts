// LandOS acquisition lane — the Deal Card workflow state machine.
//
//   Lead -> DD Report -> Discovery Call -> Underwriting -> Offer
//   Lead -> DD Report -> Discovery Call -> Deeper DD -> Underwriting -> Offer  (alt)
//
// Pure derivation over a snapshot of what the Deal Card already has — NO schema
// change, no mutation, so it can't desync from or break the existing Deal Card
// flow. Returns the stage view the dashboard renders: current stage, completed
// stages, next action + required inputs, and underwriting/offer readiness.

export type LaneStage = 'lead' | 'dd_report' | 'discovery_call' | 'deeper_dd' | 'underwriting' | 'offer';

export const LANE_PRIMARY: LaneStage[] = ['lead', 'dd_report', 'discovery_call', 'underwriting', 'offer'];
export const LANE_WITH_DEEPER_DD: LaneStage[] = ['lead', 'dd_report', 'discovery_call', 'deeper_dd', 'underwriting', 'offer'];

export const STAGE_LABELS: Record<LaneStage, string> = {
  lead: 'Lead',
  dd_report: 'DD Report',
  discovery_call: 'Discovery Call',
  deeper_dd: 'Deeper DD',
  underwriting: 'Underwriting',
  offer: 'Offer',
};

const REQUIRED_INPUTS: Record<LaneStage, string[]> = {
  lead: ['Create the Deal Card'],
  dd_report: ['Run Property Analysis / verify the parcel'],
  discovery_call: ['Attach a discovery-call summary'],
  deeper_dd: ['Attach deeper-DD findings (resolve open items)'],
  underwriting: ['Verified parcel', 'Discovery-call summary', 'Strategy lanes'],
  offer: ['Approved underwriting decision'],
};

export interface DealLaneSnapshot {
  hasCard: boolean;
  /** DD Report (Property Analysis) has been produced. */
  ddReportReady: boolean;
  parcelVerified: boolean;
  discoveryCallSummary?: string | null;
  /** Operator routed the deal through the optional Deeper DD branch. */
  usingDeeperDd?: boolean;
  /** Deeper-DD findings attached (only relevant when usingDeeperDd). */
  deeperDdComplete?: boolean;
  underwriting?: { status: 'approved' | 'needs_deeper_dd' | 'blocked_unverified' } | null;
  offerRecorded?: boolean;
}

export interface LaneStageView { stage: LaneStage; label: string; status: 'done' | 'current' | 'pending' }

export interface DealLaneView {
  usingDeeperDd: boolean;
  stages: LaneStageView[];
  completedStages: LaneStage[];
  currentStage: LaneStage;
  nextAction: { stage: LaneStage; label: string; requiredInputs: string[] } | null;
  readiness: { ddReportReady: boolean; discoveryReady: boolean; underwritingReady: boolean; offerReady: boolean };
}

function isStageDone(stage: LaneStage, s: DealLaneSnapshot): boolean {
  switch (stage) {
    case 'lead': return s.hasCard;
    case 'dd_report': return s.ddReportReady;
    case 'discovery_call': return !!(s.discoveryCallSummary && s.discoveryCallSummary.trim());
    case 'deeper_dd': return !!s.deeperDdComplete;
    case 'underwriting': return s.underwriting?.status === 'approved';
    case 'offer': return !!s.offerRecorded;
  }
}

/** Derive the lane view. Stages complete sequentially: a stage is 'done' only if
 *  it and every prior stage are satisfied; the first unsatisfied stage is current. */
export function computeDealLane(s: DealLaneSnapshot): DealLaneView {
  const usingDeeperDd = !!s.usingDeeperDd;
  const order = usingDeeperDd ? LANE_WITH_DEEPER_DD : LANE_PRIMARY;

  const completedStages: LaneStage[] = [];
  let currentStage: LaneStage = order[0];
  let foundCurrent = false;
  const stages: LaneStageView[] = order.map((stage) => {
    if (!foundCurrent && isStageDone(stage, s)) {
      completedStages.push(stage);
      return { stage, label: STAGE_LABELS[stage], status: 'done' as const };
    }
    if (!foundCurrent) { foundCurrent = true; currentStage = stage; return { stage, label: STAGE_LABELS[stage], status: 'current' as const }; }
    return { stage, label: STAGE_LABELS[stage], status: 'pending' as const };
  });
  if (!foundCurrent) currentStage = order[order.length - 1]; // all done -> sit on Offer

  const allDone = completedStages.length === order.length;
  const nextAction = allDone ? null : { stage: currentStage, label: `Next: ${STAGE_LABELS[currentStage]}`, requiredInputs: REQUIRED_INPUTS[currentStage] };

  return {
    usingDeeperDd,
    stages,
    completedStages,
    currentStage,
    nextAction,
    readiness: {
      ddReportReady: s.ddReportReady,
      discoveryReady: !!(s.discoveryCallSummary && s.discoveryCallSummary.trim()),
      underwritingReady: s.parcelVerified && s.ddReportReady && !!(s.discoveryCallSummary && s.discoveryCallSummary.trim()) && (!usingDeeperDd || !!s.deeperDdComplete),
      offerReady: s.underwriting?.status === 'approved',
    },
  };
}
