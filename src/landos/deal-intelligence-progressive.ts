// Progressive Deal Intelligence — the mid-flight partial assembly.
//
// The Deal Card must visibly update as child missions settle, not only at join.
// This module builds that in-flight view, and nothing else:
//
//   settle → the run lifecycle calls `assembleProgressiveDealIntelligence` with
//            the children as they currently stand
//   store  → the result is persisted on the RUN row as progressive content
//            (PropertyIntelligenceStore.updateProgress), never as the snapshot
//   read   → the poll serves the STORED content; a GET never reassembles
//
// Hard rules encoded here:
//   • The partial is assembled at WRITE time (on each child settle), so a read
//     performs no provider work and no reassembly (invariant 3).
//   • The partial never claims completion: `completedAt` stays null, so the
//     joined status is always `running` while any lane is outstanding
//     (invariant 6 — completeness is never claimed over a missing lane).
//   • The partial is marked `preliminary` and `isPrimary: false`. Promotion is
//     decided ONLY at join by `completeRun`; nothing here can demote a good
//     snapshot (the invariant the whole run lifecycle enforces).
//   • A lane that is merely still in flight is reported as "still in flight",
//     never with the terminal wording used for a lane that failed to report.
//
// Pure. No database, no clock beyond the injected `now`, no I/O.

import { DEAL_INTELLIGENCE_CHILDREN } from './deal-intelligence-mission.js';
import { assembleDealIntelligencePackage } from './deal-intelligence-assembly.js';
import { joinMissionChildren, type MissionChildState } from './mission-graph.js';
import {
  joinPropertyIntelligence,
  type PropertyIntelligenceProgress,
} from './property-intelligence-snapshot.js';

/** Child statuses that count as settled (terminal), contributing or not. */
const SETTLED_STATUSES: readonly string[] = [
  'completed',
  'partial',
  'failed',
  'blocked',
  'skipped',
  'rejected',
  'cancelled',
];

/** True when a child has reached a terminal state and a partial is worth rebuilding. */
export function isSettledChildStatus(status: string): boolean {
  return SETTLED_STATUSES.includes(status);
}

export interface AssembleProgressiveInput {
  dealCardId: number;
  runId: string;
  sequence: number;
  startedAt: string;
  /** Every child of the parent mission, as currently recorded. */
  children: MissionChildState[];
  now?: () => string;
}

/**
 * Assemble the in-flight partial from whatever the children have contributed so
 * far. Reuses the EXACT assembly and join the final snapshot uses, so a section
 * that appears mid-flight can never disagree with the same section at join —
 * the only differences are the running status, the preliminary marking, and
 * honest "still in flight" wording for lanes that simply have not settled yet.
 */
export function assembleProgressiveDealIntelligence(
  input: AssembleProgressiveInput,
): PropertyIntelligenceProgress {
  const { dealCardId, runId, sequence, startedAt, children } = input;
  const now = input.now ?? (() => new Date().toISOString());

  const join = joinMissionChildren({ specs: DEAL_INTELLIGENCE_CHILDREN, children });
  const pkg = assembleDealIntelligencePackage({ dealCardId, missionId: runId, join, children });

  // `completedAt: null` is the honesty seam: the joined status computes to
  // `running`, so the partial can never present itself as a finished read.
  const joined = joinPropertyIntelligence({
    dealCardId,
    runId,
    sequence,
    startedAt,
    completedAt: null,
    identity: pkg.identity,
    facts: pkg.facts,
    governmentRecords: pkg.governmentRecords,
    dueDiligence: pkg.dueDiligence,
    comps: pkg.comps,
    valuation: pkg.valuation,
    strategies: pkg.strategies,
    recommendation: pkg.recommendation,
    evidence: pkg.evidence,
    specialists: pkg.specialists,
  });

  // A lane that has not settled yet is IN FLIGHT, not delinquent. The join's
  // terminal wording ("did not report a result") is correct at join and wrong
  // mid-flight, so it is rewritten for exactly the outstanding lanes.
  const inFlightLabels = new Set(
    children.filter((child) => !isSettledChildStatus(child.status)).map((child) => child.label),
  );
  const missingInformation = joined.missingInformation.map((line) => {
    for (const label of inFlightLabels) {
      if (line === `${label}: did not report a result.`) {
        return `${label}: still in flight — no result yet.`;
      }
    }
    return line;
  });

  const settled = children.filter((child) => isSettledChildStatus(child.status)).map((child) => child.key);
  const outstanding = children.filter((child) => !isSettledChildStatus(child.status)).map((child) => child.key);

  return {
    preliminary: true,
    runId,
    dealCardId,
    sequence,
    updatedAt: now(),
    settled,
    outstanding,
    snapshot: {
      ...joined,
      missionId: runId,
      missingInformation,
      // Never the promoted read, and marked so every consumer can see it.
      isPrimary: false,
      preliminary: true,
    },
  };
}
