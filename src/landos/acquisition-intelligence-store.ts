// LandOS — persisting the Acquisition Intelligence read.
//
// One current read per Deal Card, on the derived-intelligence seam LandOS
// already uses for post-resolution intelligence. No new table, no new database,
// no second intelligence store.
//
// Why the persistence shape matters to the operator:
//
//   • Opening a Deal Card must never start a reasoning run. The read is a
//     SELECT, and a page reload returns the same read it returned before.
//   • Superseding rather than overwriting means an earlier judgment stays
//     recoverable when a refreshed one lands.
//   • The read carries the fingerprint of the exact property file it was formed
//     from, so "new evidence has landed since this read" is answerable without
//     re-running anything.
//
// This is a JUDGMENT, not evidence. It writes a derived snapshot and no
// evidence rows: nothing here may become a property fact, and nothing here can
// move canonical identity.

import {
  readDerivedSnapshot,
  readDerivedSnapshotHistory,
  writeDerivedSnapshot,
} from './derived-intelligence-store.js';
import type { AcquisitionIntelligenceResult } from './acquisition-intelligence-contract.js';

export const ACQUISITION_INTELLIGENCE_SNAPSHOT_TYPE = 'acquisition_intelligence_v1';
export const ACQUISITION_INTELLIGENCE_ACTOR = 'acquisition-intelligence';

export interface PersistAcquisitionIntelligenceResult {
  persisted: boolean;
  snapshotId: number | null;
  reused: boolean;
  skippedReason: string | null;
}

export function persistAcquisitionIntelligence(input: {
  dealCardId: number;
  result: AcquisitionIntelligenceResult;
  changeReason?: string;
}): PersistAcquisitionIntelligenceResult {
  const outcome = writeDerivedSnapshot({
    dealCardId: input.dealCardId,
    snapshotType: ACQUISITION_INTELLIGENCE_SNAPSHOT_TYPE,
    payload: input.result as unknown,
    completeness: {
      strategies: input.result.strategies.length,
      opportunities: input.result.opportunities.length,
      constraints: input.result.constraints.length,
      conflicts: input.result.conflicts.length,
      visualObservations: input.result.visualObservations.length,
      coverageAbsent: input.result.basis.coverageAbsent,
      warnings: input.result.warnings,
    },
    changeReason: input.changeReason
      ?? `Acquisition Intelligence read produced by ${input.result.runtime.agentProfile} on ${input.result.runtime.model}.`,
    actor: ACQUISITION_INTELLIGENCE_ACTOR,
    auditEvent: 'acquisition_intelligence_read',
  });
  return {
    persisted: outcome.snapshotId != null && !outcome.reused,
    snapshotId: outcome.snapshotId,
    reused: outcome.reused,
    skippedReason: outcome.skippedReason,
  };
}

/** The current read, or null. A pure SELECT: reading never runs a model. */
export function readAcquisitionIntelligence(dealCardId: number): AcquisitionIntelligenceResult | null {
  return readDerivedSnapshot<AcquisitionIntelligenceResult>(dealCardId, ACQUISITION_INTELLIGENCE_SNAPSHOT_TYPE);
}

/** Superseded reads, oldest first. Retained so a refreshed judgment never
 *  destroys the one an operator may have already acted on. */
export function readAcquisitionIntelligenceHistory(dealCardId: number): AcquisitionIntelligenceResult[] {
  return readDerivedSnapshotHistory<AcquisitionIntelligenceResult>(dealCardId, ACQUISITION_INTELLIGENCE_SNAPSHOT_TYPE);
}
