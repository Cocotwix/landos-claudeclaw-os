// Automatic Deal Intelligence launch from New Lead intake — Phase 5.
//
// Saving a valid new lead starts the ONE Deal Intelligence parent mission for
// the created Deal Card, fire-and-forget: the intake response never waits on
// the mission, and a launch problem never breaks the save. This module owns
// that decision; the intake route makes one thin call into it.
//
// Why this REPLACES queuePhase1Research on the manual-intake path only:
//   • The mission's `deal_card_projection` child re-runs the exact same
//     LandPortal + county subject-research workflow Phase-1 research triggers
//     (`runDealCardReportWorkflow` → the legacy report), so launching both
//     from one intake would run the heavy legacy report TWICE, concurrently,
//     against the same lead — and both drive the ONE approved Chrome tab.
//   • The opportunity lifecycle Phase-1 research used to advance is advanced
//     from the mission instead: research_status running → complete/partial/
//     failed on the mission outcome, and the discovery package + brief_ready
//     are built from the refreshed projections after a usable join.
//   • Every OTHER intake and retry path (owner retry, from-verification, …)
//     keeps calling queuePhase1Research exactly as before.
//
// Duplicate handling: launchDealIntelligenceMission already refuses a second
// mission while one is active for the Deal Card (missionStore.activeMission +
// snapshotStore.activeRun). A duplicate submission that reaches the same Deal
// Card gets `alreadyRunning` back and advances nothing twice.

import { logger } from '../logger.js';
import {
  launchDealIntelligenceMission,
  type DealIntelligenceLaunch,
  type LaunchDealIntelligenceOptions,
} from './deal-intelligence-run.js';
import { updateOpportunityDiscoveryStatus, updateOpportunityResearchStatus, type OpportunityResearchStatus } from './opportunity.js';
import { buildOpportunityDiscoveryPackage } from './opportunity-discovery-package.js';
import { PropertyIntelligenceStore } from './property-intelligence-store.js';
import type { PropertyIntelligenceSnapshot, SnapshotStatus } from './property-intelligence-snapshot.js';

const INTAKE_ACTOR = 'deal-intelligence';
export const INTAKE_TRIGGER = 'automatic_manual_intake';

/** Opportunity-lifecycle side effects, injectable so tests never need live rows. */
export interface IntakeLifecycleHooks {
  research: (opportunityId: number, status: OpportunityResearchStatus, note: string) => void;
  /** Build + persist the discovery package and mark the brief ready. */
  discoveryBrief: (opportunityId: number, note: string) => void;
}

const DEFAULT_HOOKS: IntakeLifecycleHooks = {
  research: (opportunityId, status, note) => {
    updateOpportunityResearchStatus(opportunityId, status, { actor: INTAKE_ACTOR, note });
  },
  discoveryBrief: (opportunityId, note) => {
    buildOpportunityDiscoveryPackage(opportunityId, { persist: true, actor: INTAKE_ACTOR });
    updateOpportunityDiscoveryStatus(opportunityId, 'brief_ready', { actor: INTAKE_ACTOR, note });
  },
};

/**
 * How a finished mission reads as an opportunity research status.
 *
 * The STORED run status is consulted alongside the returned snapshot because a
 * run the operator cannot use as the current read (orchestration broke, or the
 * subject was never established) is recorded `failed` even though the attempt's
 * snapshot object is retained as history — and that run must never read as
 * partial research success.
 */
export function researchStatusForOutcome(
  snapshot: PropertyIntelligenceSnapshot | null,
  runStatus: SnapshotStatus | null,
): Extract<OpportunityResearchStatus, 'complete' | 'partial' | 'failed'> {
  if (!snapshot || runStatus === 'failed' || snapshot.status === 'failed') return 'failed';
  return snapshot.status === 'complete' ? 'complete' : 'partial';
}

export interface AutoLaunchIntakeInput extends Omit<LaunchDealIntelligenceOptions, 'trigger'> {
  opportunityId: number;
  hooks?: Partial<IntakeLifecycleHooks>;
}

/**
 * Launch the Deal Intelligence mission for a freshly saved lead.
 *
 * Never throws and never blocks: the caller's 201 response goes out whatever
 * happens here. Returns the launch record (or null when even the launch step
 * failed) so the caller can log it.
 */
export function autoLaunchDealIntelligenceForIntake(input: AutoLaunchIntakeInput): DealIntelligenceLaunch | null {
  const { opportunityId, hooks: overrides, ...launchOptions } = input;
  const hooks: IntakeLifecycleHooks = { ...DEFAULT_HOOKS, ...overrides };
  const { dealCardId } = launchOptions;
  // One shared store, so the settle path below reads the SAME run row the
  // launch wrote, whatever the caller injected.
  const snapshotStore = launchOptions.snapshotStore ?? new PropertyIntelligenceStore();

  try {
    const { launch, completion } = launchDealIntelligenceMission({
      ...launchOptions,
      snapshotStore,
      trigger: INTAKE_TRIGGER,
    });

    if (launch.alreadyRunning) {
      // A mission is already active for this Deal Card — the duplicate intake
      // advances nothing twice and simply reports the run in flight.
      logger.info(
        { dealCardId, opportunityId, runId: launch.runId, missionId: launch.missionId },
        'deal_intelligence_intake_already_running',
      );
      return launch;
    }

    logger.info(
      { dealCardId, opportunityId, runId: launch.runId, missionId: launch.missionId, childCount: launch.childCount },
      'deal_intelligence_intake_launched',
    );

    try {
      hooks.research(opportunityId, 'running', `Deal Intelligence mission ${launch.missionId} launched automatically from New Lead intake.`);
    } catch (err) {
      logger.warn({ err, dealCardId, opportunityId }, 'deal_intelligence_intake_research_status_failed');
    }

    // Fire-and-forget: the settle path runs long after the intake response.
    void completion
      .then((snapshot) => {
        // The run row is re-read before any lifecycle write. A row that no
        // longer exists means the world this launch belonged to is gone (the
        // store was reset or replaced underneath a still-running chain); an
        // opportunity id is only meaningful in the world that assigned it, so
        // writing research status or a brief from a vanished run would attach
        // this mission's outcome to whatever now happens to own that id.
        const storedRun = ((): { status: SnapshotStatus } | null => {
          try { return snapshotStore.getRun(launch.runId) ?? null; } catch { return null; }
        })();
        if (!storedRun) {
          logger.warn({ dealCardId, opportunityId, runId: launch.runId }, 'deal_intelligence_intake_run_row_missing');
          return;
        }
        const status = researchStatusForOutcome(snapshot, storedRun.status);
        try {
          hooks.research(
            opportunityId,
            status,
            snapshot
              ? `Deal Intelligence mission ${launch.missionId} finished: ${status === 'failed' ? 'the run could not be used as the current read' : snapshot.status.replace(/_/g, ' ')}.`
              : `Deal Intelligence mission ${launch.missionId} did not produce a usable snapshot. Re-run Property Intelligence from the Deal Card.`,
          );
        } catch (err) {
          logger.warn({ err, dealCardId, opportunityId }, 'deal_intelligence_intake_research_status_failed');
        }
        if (snapshot && status !== 'failed') {
          try {
            hooks.discoveryBrief(
              opportunityId,
              snapshot.status === 'complete'
                ? 'Discovery package assembled from the completed Deal Intelligence mission.'
                : 'Discovery package assembled from the Deal Intelligence mission; named gaps remain and are listed on the snapshot.',
            );
          } catch (err) {
            logger.warn({ err, dealCardId, opportunityId }, 'deal_intelligence_intake_discovery_brief_failed');
          }
        }
      })
      .catch((err) => {
        logger.warn({ err, dealCardId, opportunityId }, 'deal_intelligence_intake_mission_failed');
        try {
          hooks.research(opportunityId, 'failed', 'The automatically launched Deal Intelligence mission failed. Re-run Property Intelligence from the Deal Card.');
        } catch (statusErr) {
          logger.warn({ err: statusErr, dealCardId, opportunityId }, 'deal_intelligence_intake_research_status_failed');
        }
      });

    return launch;
  } catch (error) {
    // The lead is saved either way; the operator can launch manually from the
    // Deal Card, which stays fully available.
    logger.warn({ err: error, dealCardId, opportunityId }, 'deal_intelligence_intake_launch_failed');
    return null;
  }
}
