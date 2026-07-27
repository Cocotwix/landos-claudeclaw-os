// Deal Intelligence analysis — the Analyst stage of Phase 5 Item 20.
//
// The Operator assembled the exact input package; this stage EVALUATES the
// property from it and produces one Deal Intelligence Snapshot. It is the only
// place a conclusion is formed, and it forms conclusions from nothing except the
// package it was handed.
//
// The honesty rule this stage enforces is the Phase 5 one: a missing lane must
// affect the conclusion it materially bears on, and nothing else. So:
//   • A missing lane is always listed under missing information.
//   • A missing lane never rewrites the valuation, and never downgrades the
//     posture on its own — the strategy analysis already qualified whatever it
//     actually affects.
//   • A missing SUBJECT IDENTITY is different in kind: without an identified
//     parcel there is no subject, so parcel-specific conclusions are withheld.
//     That is invariant 7, not a completeness grade.
//
// Pure. No database, no clock, no I/O.

import { joinPropertyIntelligence, type PropertyIntelligenceSnapshot } from './property-intelligence-snapshot.js';
import type { DealIntelligenceInputPackage } from './deal-intelligence-assembly.js';

export interface AnalyseDealIntelligenceInput {
  package: DealIntelligenceInputPackage;
  runId: string;
  sequence: number;
  startedAt: string;
  completedAt: string;
}

/**
 * Turn one assembled package into one snapshot.
 *
 * `joinPropertyIntelligence` is reused unchanged: it already computes status,
 * confidence, blockers, missing information and next actions strictly from what
 * the specialists returned, and Phase 5 has no reason to compute those twice.
 * What this stage adds on top is the MISSION-level truth the join cannot see —
 * the parent outcome, the named lane gaps, and the package blockers.
 */
export function analyseDealIntelligence(input: AnalyseDealIntelligenceInput): PropertyIntelligenceSnapshot {
  const pkg = input.package;

  // Mission-level blockers. A gap in a SUPPORTING lane is informative, never a
  // blocker: treating it as one is exactly the "downgrade the whole deal for an
  // incomplete record" behaviour Phase 5 forbids.
  const extraBlockers: string[] = [...pkg.packageBlockers];
  for (const gap of pkg.requiredGaps) {
    // A skipped lane is a CONSEQUENCE of another gap, already named at its root.
    // Repeating it as an independent blocker would make one problem look like two.
    if (gap.status === 'skipped') continue;
    extraBlockers.push(
      `${gap.label} (${gap.status}${gap.acceptanceState !== 'not_evaluated' ? `, ${gap.acceptanceState}` : ''}) did not contribute to this run: ${gap.reason}`,
    );
  }

  const snapshot = joinPropertyIntelligence({
    dealCardId: pkg.dealCardId,
    runId: input.runId,
    sequence: input.sequence,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
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
    extraBlockers,
  });

  // The mission's own outcome sentence travels with the snapshot. Without it the
  // operator would have to open the mission panel to learn that, for example,
  // two lanes were only incomplete rather than accepted.
  const missionLine =
    `Parent mission ${pkg.missionId}: ${pkg.missionStatus.replace(/_/g, ' ')}. ${pkg.missionOutcome}`;

  const supportingGaps = pkg.gaps.filter((gap) => gap.role === 'supporting');
  const missingInformation = [
    ...snapshot.missingInformation,
    ...supportingGaps.map(
      (gap) => `${gap.label} (supporting, ${gap.status}) did not contribute: ${gap.reason} This limits the context it would have added; it does not change the conclusions drawn from the lanes that did land.`,
    ),
  ];

  return {
    ...snapshot,
    blockers: dedupe([...snapshot.blockers]),
    missingInformation: dedupe([...missingInformation, missionLine]),
  };
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}
