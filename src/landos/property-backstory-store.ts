// LandOS — durable Property Backstory.
//
// The backstory is a DERIVED read. Its evidence already lives in
// `landos_property_evidence_item` as official-document findings, written by
// `official-document-intelligence-store.ts` when the resolver mined the source.
// Re-writing those findings under a second domain would duplicate evidence and
// let two copies drift, so this stores exactly one thing: the current derived
// read, superseded rather than overwritten, on the snapshot table LandOS
// already uses for derived reads.
//
// The consequence that matters: a restart, a new session or a different process
// reads `readPropertyBackstory` and gets the whole timeline back with its
// provenance intact, without a network call and without the PDFs.

import {
  readDerivedSnapshot,
  readDerivedSnapshotHistory,
  writeDerivedSnapshot,
} from './derived-intelligence-store.js';
import type { PropertyBackstory } from './property-backstory.js';

export const PROPERTY_BACKSTORY_SNAPSHOT_TYPE = 'property_backstory_v1';
export const PROPERTY_BACKSTORY_COLLECTOR = 'property_backstory';

export interface PersistBackstoryResult {
  persisted: boolean;
  snapshotId: number | null;
  reused: boolean;
  skippedReason: string | null;
}

/** Write the current backstory, superseding the prior one. */
export function persistPropertyBackstory(input: {
  backstory: PropertyBackstory;
  actor?: string;
}): PersistBackstoryResult {
  const { backstory } = input;
  const evidenceIds = backstory.events
    .flatMap((event) => event.evidence.map((ref) => ref.evidenceId))
    .filter((id): id is number => typeof id === 'number');

  const outcome = writeDerivedSnapshot({
    dealCardId: backstory.dealCardId,
    snapshotType: PROPERTY_BACKSTORY_SNAPSHOT_TYPE,
    payload: backstory,
    completeness: {
      eventCount: backstory.events.length,
      datedEventCount: backstory.events.filter((event) => event.eventDate).length,
      zoningReferenceCount: backstory.zoningReferences.length,
      documentsReused: backstory.documentsReused.length,
      documentsRetrieved: backstory.documentsRetrieved.length,
      limitations: backstory.limitations,
    },
    evidenceIds,
    changeReason: backstory.events.length
      ? `Property Backstory rebuilt from ${backstory.events.length} subject-specific event(s) across ${backstory.documentsReused.length + backstory.documentsRetrieved.length} official document(s).`
      : 'Property Backstory recorded with no subject-specific events found in the retained official record.',
    actor: input.actor ?? PROPERTY_BACKSTORY_COLLECTOR,
    auditEvent: 'property_backstory_persisted',
  });

  return {
    persisted: outcome.snapshotId != null,
    snapshotId: outcome.snapshotId,
    reused: outcome.reused,
    skippedReason: outcome.skippedReason,
  };
}

/** The current backstory for this Deal Card. A pure SELECT. */
export function readPropertyBackstory(dealCardId: number): PropertyBackstory | null {
  return readDerivedSnapshot<PropertyBackstory>(dealCardId, PROPERTY_BACKSTORY_SNAPSHOT_TYPE);
}

/** Superseded backstories, retained as history. */
export function readPropertyBackstoryHistory(dealCardId: number): PropertyBackstory[] {
  return readDerivedSnapshotHistory<PropertyBackstory>(dealCardId, PROPERTY_BACKSTORY_SNAPSHOT_TYPE);
}
