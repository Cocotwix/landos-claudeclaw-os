// Shared contracts for the canonical Deal Intelligence collectors.
//
// These types used to live inside the obsolete in-process
// property-intelligence-mission implementation. Keeping the contracts separate
// lets the mission graph reuse the proven collectors without retaining a second
// executable orchestration path.

import type {
  SnapshotDueDiligenceItem,
  SnapshotEvidenceItem,
  SnapshotFact,
  SnapshotIdentity,
} from './property-intelligence-snapshot.js';
import type { CompRegistryCandidate, SubjectMarket } from './comp-registry.js';

export interface SpecialistOutcome<T> {
  status: 'completed' | 'partial' | 'blocked';
  summary: string;
  data: T | null;
  evidence?: SnapshotEvidenceItem[];
}

export interface IdentityContribution {
  capabilityResolution: 'RESOLVED' | 'AMBIGUOUS' | 'UNRESOLVED' | 'ERROR';
  capabilityInvocationId: string;
  identity: SnapshotIdentity;
  discoveryUsable?: boolean;
  discoveryBasis?: string | null;
  facts: SnapshotFact[];
  subjectMarket: SubjectMarket;
  subjectAcres: number | null;
  acreageConflict: boolean;
}

export interface GovernmentRecordsContribution {
  records: SnapshotFact[];
  /** Actual source collector attempts, excluding orchestration-only visits. */
  collectorAttemptCount?: number;
  /** Precise source limitations when no usable official record was retrieved. */
  sourceLimitations?: string[];
}

export interface ZoningContribution {
  zoning: string | null;
  zoningKnown: boolean;
  items: SnapshotDueDiligenceItem[];
  facts: SnapshotFact[];
  collectorAttemptCount?: number;
  sourceLimitations?: string[];
}

export interface EnvironmentalContribution {
  items: SnapshotDueDiligenceItem[];
  constraints: string[];
  /** Number of environmental source collectors that actually ran. */
  screenedLaneCount?: number;
  sourceLimitations?: string[];
}

export interface AccessUtilitiesContribution {
  items: SnapshotDueDiligenceItem[];
  accessStatus: 'public_road_proximity' | 'private_road_only' | 'no_mapped_contact' | 'unknown';
  utilitiesKnown: boolean;
  utilitiesSummary: string | null;
  collectorAttemptCount?: number;
  sourceLimitations?: string[];
}

export interface ComparablesContribution {
  candidates: CompRegistryCandidate[];
  duplicatesMerged: number;
  landHomeSearchProof?: {
    status: 'completed' | 'blocked' | 'unavailable' | 'not_run';
    radiusMiles: number;
    timePeriodMonths: number;
    sourcesSearched: string[];
    routesAttempted: string[];
    candidatesReviewed: number;
    qualifyingResults: number;
    exclusionReasons: Array<{ reason: string; count: number }>;
  } | null;
}

export interface MarketContribution {
  facts: SnapshotFact[];
  summary: string;
}

export interface EvidenceContribution {
  evidence: SnapshotEvidenceItem[];
}

/** Which comparable lanes a FOCUSED rerun asked for. Absent means every
 *  lane, exactly as the full mission runs them. */
export interface ComparableLaneScope {
  /** LandPortal, Zillow, Redfin, Realtor.com and exact-address vacant-land research. */
  vacantLand: boolean;
  /** The sold manufactured-home market screen (Zillow, Redfin, Realtor.com). */
  manufacturedHomes: boolean;
}

export interface MissionContext {
  dealCardId: number;
  runId: string;
  identity: IdentityContribution | null;
  comparables: ComparablesContribution | null;
  laneScope?: ComparableLaneScope | null;
}

export interface PropertyIntelligenceCollectors {
  parcel_identity(ctx: MissionContext): Promise<SpecialistOutcome<IdentityContribution>>;
  government_records(ctx: MissionContext): Promise<SpecialistOutcome<GovernmentRecordsContribution>>;
  zoning_land_use(ctx: MissionContext): Promise<SpecialistOutcome<ZoningContribution>>;
  environmental_terrain(ctx: MissionContext): Promise<SpecialistOutcome<EnvironmentalContribution>>;
  access_utilities(ctx: MissionContext): Promise<SpecialistOutcome<AccessUtilitiesContribution>>;
  comparables(ctx: MissionContext): Promise<SpecialistOutcome<ComparablesContribution>>;
  market_intelligence(ctx: MissionContext): Promise<SpecialistOutcome<MarketContribution>>;
  evidence_visuals(ctx: MissionContext): Promise<SpecialistOutcome<EvidenceContribution>>;
}
