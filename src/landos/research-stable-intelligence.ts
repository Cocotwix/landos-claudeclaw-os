// LandOS — producing Property and Market Intelligence when research settles.
//
// Stage 0 found the gap this file closes. Deal 115 held nine research snapshots
// and zero intelligence products, because research completing was wired to
// nothing: the only paths to a product were an operator button and a chained
// cascade that dies across a managed restart. Research finished, and the
// operator's screen still said the work had not started.
//
// So the trigger here is a STATE, not a button. When a Working Acquisition
// Subject is research-ready and the property file carries established research,
// LandOS produces both readings. It is safe to call on any transition, and on a
// read, because of three properties held deliberately:
//
//   DETERMINISTIC   both builders are pure functions over retained evidence.
//                   No model call, no browser, no network, no cost.
//   IDEMPOTENT      the shared derived-snapshot seam dedupes on its input hash,
//                   so unchanged evidence writes nothing and the retained read
//                   keeps its original provenance and version.
//   NON-BLOCKING    Seller Intelligence stays `pending discovery` until genuine
//                   communications exist, and incomplete valuation, zoning,
//                   access or seller evidence never withholds the two readings
//                   that CAN be formed. A thin file produces a thin, honest
//                   report — not an empty screen.
//
// Nothing here writes canonical identity, and nothing re-runs research. Both
// products attach to the current property identity version through the same
// seam every other derived read uses, so a reading formed about a superseded
// parcel is withheld from current surfaces rather than silently presented.

import {
  buildAcquisitionDossier,
  type AcquisitionDossier,
  type PropertyFileSource,
} from './acquisition-intelligence-dossier.js';
import { resolveCanonicalSubjectState, type CanonicalSubjectState } from './canonical-subject-state.js';
import { getLandosDb } from './db.js';
import {
  readDerivedSnapshotForParcel,
  writeDerivedSnapshot,
  type ParcelCorrelation,
} from './derived-intelligence-store.js';
import {
  acreageBandForAcres,
  acreageBandsForAcres,
  resolveMarketMatrix,
  type MarketMatrixResolution,
} from './market-matrix-read.js';
import type { AcreageBand } from './market-matrix.js';
import {
  buildPropertyEvidenceSynthesis,
  type PropertyEvidenceSynthesis,
  type ProviderAssessmentRecord,
} from './property-evidence-synthesis.js';
import {
  buildMarketResearchAndPulse,
  type MarketResearchAndPulse,
} from './market-research-and-pulse.js';
import { readSubjectUnderstanding } from './subject-understanding-capability.js';
import type { SubjectUnderstandingResult } from './subject-understanding.js';

export const PROPERTY_EVIDENCE_SYNTHESIS_SNAPSHOT = 'property_evidence_synthesis_v1';
export const MARKET_RESEARCH_PULSE_SNAPSHOT = 'market_research_pulse_v1';

export const PROPERTY_EVIDENCE_SYNTHESIS_SKILL = 'landos-property-evidence-synthesis';
export const MARKET_RESEARCH_PULSE_SKILL = 'landos-market-research-and-pulse';

/** Seller Intelligence is a separate lane. It is reported, never awaited. */
export type SellerIntelligenceReadiness = 'pending_discovery' | 'communications_established';

export interface ResearchStability {
  stable: boolean;
  /** Why, in one operator sentence. Always populated, stable or not. */
  reason: string;
  signals: {
    subjectResolved: boolean;
    understandingOutcome: SubjectUnderstandingResult['outcome'] | 'not_retained';
    identityConfirmed: boolean;
    establishedTopics: number;
  };
  /** Reported so a surface can show the lane honestly. Never a gate. */
  sellerIntelligence: SellerIntelligenceReadiness;
}

export interface StabilityInput {
  subject: Pick<CanonicalSubjectState, 'subjectResolved'>;
  understanding: Pick<SubjectUnderstandingResult, 'outcome'> | null;
  dossier: Pick<AcquisitionDossier, 'coverage' | 'identity' | 'seller'>;
}

/**
 * PURE. Has research reached a state worth reading?
 *
 * Deliberately low: an accepted, research-ready subject plus at least one
 * established research topic. Waiting for valuation, zoning, access or a seller
 * conversation is what produced a Deal Card with nine research snapshots and
 * nothing to show for them.
 */
export function assessResearchStability(input: StabilityInput): ResearchStability {
  const understandingOutcome: SubjectUnderstandingResult['outcome'] | 'not_retained' =
    input.understanding?.outcome ?? 'not_retained';
  const establishedTopics = input.dossier.coverage.present.length;
  const identityConfirmed = input.dossier.identity.confirmed;
  const sellerIntelligence: SellerIntelligenceReadiness =
    input.dossier.seller.communications.length > 0 || input.dossier.seller.discovery.length > 0
      ? 'communications_established'
      : 'pending_discovery';

  const signals = {
    subjectResolved: input.subject.subjectResolved,
    understandingOutcome,
    identityConfirmed,
    establishedTopics,
  };

  // A retained reading governs when there is one. Without one, an accepted
  // canonical subject is itself the research-ready signal — Stage 2's reading is
  // how a lead BECOMES research-ready, not a permanent precondition for having
  // been one.
  const researchReady = understandingOutcome === 'research_ready'
    || (understandingOutcome === 'not_retained' && input.subject.subjectResolved);

  if (!input.subject.subjectResolved) {
    return {
      stable: false,
      reason: 'No accepted Working Acquisition Subject exists yet, so there is nothing to research against.',
      signals,
      sellerIntelligence,
    };
  }
  if (!researchReady) {
    return {
      stable: false,
      reason: understandingOutcome === 'candidate_set'
        ? 'The subject reading returned a candidate set; the parcel must be settled before intelligence is formed about it.'
        : 'The subject reading needs targeted operator input before intelligence is formed about it.',
      signals,
      sellerIntelligence,
    };
  }
  if (establishedTopics < 1) {
    return {
      stable: false,
      reason: 'Nothing has been established about this property yet; research has not produced anything to read.',
      signals,
      sellerIntelligence,
    };
  }
  return {
    stable: true,
    reason: `Research is stable: the subject is research-ready and ${establishedTopics} research topic(s) are established. `
      + (sellerIntelligence === 'pending_discovery'
        ? 'Seller Intelligence stays pending discovery and does not block this reading.'
        : 'Seller communications exist and are read in their own lane.'),
    signals,
    sellerIntelligence,
  };
}

// ── Market resolution ───────────────────────────────────────────────────────

/** The bands a county ladder is built from. `all`, `50+` and `100+` overlap
 *  their neighbours and would double-count the ladder, so the ladder uses the
 *  eight disjoint spans. */
const LADDER_BANDS: AcreageBand[] = ['0-1', '1-2', '2-5', '5-10', '10-20', '20-50', '50-100', '100+'];

export type MarketResolver = (input: Parameters<typeof resolveMarketMatrix>[0]) => MarketMatrixResolution;

export interface ResolvedMarketInputs {
  subjectBand: MarketMatrixResolution;
  countyContext: MarketMatrixResolution;
  zipContext: MarketMatrixResolution | null;
  bandLadder: MarketMatrixResolution[];
}

/**
 * Resolve every market record the Market Story needs.
 *
 * The ladder keeps only records the county itself carried for the band that was
 * ASKED for. The resolver widens geography and band when its primary request
 * misses, which is right for the subject's own read and wrong for a ladder — a
 * widened record placed on a band's rung would label another population with
 * that band's name, which is the exact Stage 0 defect in a new costume.
 */
export function resolveMarketInputs(
  geography: { county: string | null; fips: string | null; state: string | null; zip: string | null; acres: number | null },
  resolver: MarketResolver = resolveMarketMatrix,
): ResolvedMarketInputs {
  const county = geography.fips ?? geography.county ?? undefined;
  const state = geography.state ?? undefined;
  const zip = geography.zip ?? undefined;
  const band = acreageBandForAcres(geography.acres) ?? undefined;
  const bands = acreageBandsForAcres(geography.acres);

  const subjectBand = resolver({ state, county, zip, acreageBand: band, acreageBands: bands });
  const countyContext = resolver({ state, county, acreageBand: band, acreageBands: bands });

  // The ZIP slot may only carry a record the ZIP ITSELF answered.
  //
  // The resolver widens to the county when a rural ZIP holds no row with real
  // activity, which is correct for the subject's own read and wrong here: a
  // county record rendered under a "ZIP context" heading is the Stage 0 defect
  // wearing different clothes — a population labelled with a geography it does
  // not describe. When the ZIP did not answer, the slot says so.
  const zipResolved = zip ? resolver({ state, county, zip, acreageBand: band, acreageBands: bands }) : null;
  const zipAnswered = zipResolved?.matchLevel === 'zip' || zipResolved?.matchLevel === 'zip_all_acreage';
  const zipContext = !zipResolved
    ? null
    : zipAnswered
      ? zipResolved
      : {
        ...zipResolved,
        matchLevel: 'unavailable' as const,
        available: false,
        resolvedKey: null,
        resolvedKeyLabel: null,
        acreageBandUsed: null,
        period: null,
        confidence: null,
        source: null,
        provider: null,
        metrics: null,
        staleness: { label: 'No snapshot', quartersOld: null, isStale: false },
        note: `ZIP ${zip} holds no retained market record with real activity for this band; `
          + `${zipResolved.resolvedKeyLabel ?? 'a wider geography'} answered the subject read instead.`,
      };

  const bandLadder: MarketMatrixResolution[] = [];
  if (county) {
    for (const rung of LADDER_BANDS) {
      const resolution = resolver({ state, county, acreageBand: rung });
      if (!resolution.available) continue;
      if (resolution.matchLevel !== 'county') continue;
      if (resolution.acreageBandUsed !== rung) continue;
      bandLadder.push(resolution);
    }
  }
  return { subjectBand, countyContext, zipContext, bandLadder };
}

/**
 * The provider's retained assessment and tax figures, read from the same parcel
 * fact sheet the workspace already renders.
 *
 * The dossier carries only the OFFICIAL assessor record, so a deal whose
 * Assessor & Tax capability has not run yet reached the synthesis with no tax
 * evidence at all — and the Story reported "no assessment or tax record is
 * retained" beside a panel showing an assessed value and an annual tax. These
 * figures are provider-record evidence, never the official roll.
 */
function providerAssessmentFrom(source: PropertyFileSource): ProviderAssessmentRecord | null {
  const valuation = (source.propertyIntelligence as {
    landPortalFacts?: { valuation?: Record<string, unknown> };
  } | null | undefined)?.landPortalFacts?.valuation;
  if (!valuation) return null;
  const text = (value: unknown): string | null => {
    const raw = String(value ?? '').trim();
    return raw && raw !== '-' ? raw : null;
  };
  const record: ProviderAssessmentRecord = {
    assessedValue: text(valuation.assessedValue),
    totalMarketValue: text(valuation.totalMarketValue),
    taxAmount: text(valuation.taxAmount),
    sourceName: 'LandPortal parcel record',
  };
  return record.assessedValue || record.totalMarketValue || record.taxAmount ? record : null;
}

// ── Producing both readings ─────────────────────────────────────────────────

export interface ResearchStableIntelligenceDeps {
  /** The canonical property file. The route owns the plumbing. */
  readPropertyFile: (dealCardId: number) => PropertyFileSource | null;
  readSubject?: (dealCardId: number) => CanonicalSubjectState;
  readUnderstanding?: (dealCardId: number) => SubjectUnderstandingResult | null;
  resolveMarket?: MarketResolver;
  writeSnapshot?: typeof writeDerivedSnapshot;
  now?: () => Date;
  actor?: string;
  runId?: string | null;
}

export interface ResearchStableIntelligenceResult {
  outcome: 'produced' | 'unchanged' | 'not_stable' | 'no_property_file';
  stability: ResearchStability | null;
  property: PropertyEvidenceSynthesis | null;
  market: MarketResearchAndPulse | null;
  persistence: {
    property: { snapshotId: number | null; written: boolean; skippedReason: string | null };
    market: { snapshotId: number | null; written: boolean; skippedReason: string | null };
  };
  /** Seller Intelligence, reported so a caller never has to infer it. */
  sellerIntelligence: SellerIntelligenceReadiness | null;
}

/**
 * Produce and persist both readings when research is stable.
 *
 * Safe to call from a transition or a read: unchanged evidence produces the
 * same payload, the seam reuses the existing row, and nothing is written.
 */
export function ensureResearchStableIntelligence(
  dealCardId: number,
  deps: ResearchStableIntelligenceDeps,
): ResearchStableIntelligenceResult {
  const empty = {
    property: { snapshotId: null, written: false, skippedReason: null },
    market: { snapshotId: null, written: false, skippedReason: null },
  };
  const source = deps.readPropertyFile(dealCardId);
  if (!source) {
    return { outcome: 'no_property_file', stability: null, property: null, market: null, persistence: empty, sellerIntelligence: null };
  }

  const dossier = buildAcquisitionDossier(source);
  const subject = (deps.readSubject ?? resolveCanonicalSubjectState)(dealCardId);
  const understanding = (deps.readUnderstanding ?? readSubjectUnderstanding)(dealCardId);
  const stability = assessResearchStability({ subject, understanding, dossier });
  if (!stability.stable) {
    return {
      outcome: 'not_stable',
      stability,
      property: null,
      market: null,
      persistence: empty,
      sellerIntelligence: stability.sellerIntelligence,
    };
  }

  const now = deps.now ?? (() => new Date());
  // Did the retained subject reading answer about the parcel this Deal Card is
  // NOW about? A reading that did not may still describe a real transaction —
  // just not this one — so its scope is withheld rather than inherited.
  const ranAgainst = (understanding as { ranAgainstSubjectVersion?: string | null } | null)
    ?.ranAgainstSubjectVersion ?? null;
  const understandingIsCurrent = ranAgainst == null || ranAgainst === subject.subjectVersion;

  const property = buildPropertyEvidenceSynthesis({
    dealCardId,
    dossier,
    subject,
    understanding,
    understandingIsCurrent,
    providerAssessment: providerAssessmentFrom(source),
    now,
  });

  const geography = {
    county: subject.county ?? dossier.identity.county,
    fips: subject.fips,
    state: subject.state ?? dossier.identity.stateCode,
    zip: subject.zip,
    acres: subject.governingAcreage.value ?? dossier.identity.acres,
    subjectVersion: subject.subjectVersion,
  };
  const resolved = resolveMarketInputs(geography, deps.resolveMarket);
  const market = buildMarketResearchAndPulse({
    dealCardId,
    geography,
    subjectBand: resolved.subjectBand,
    countyContext: resolved.countyContext,
    zipContext: resolved.zipContext,
    bandLadder: resolved.bandLadder,
    now,
  });

  const write = deps.writeSnapshot ?? writeDerivedSnapshot;
  const actor = deps.actor ?? 'capability:research-stable-intelligence';

  // `generatedAt` is nulled in the PERSISTED payload on purpose.
  //
  // The seam's input hash covers the whole payload, so a wall-clock timestamp
  // inside it would make every read a materially "new" reading and supersede an
  // identical one every few seconds. The row's own `created_at` is the honest
  // answer to when the reading was retained, and `readRetainedReading` below
  // returns it — so nothing is lost and the dedupe actually works.
  const propertyWrite = write({
    dealCardId,
    snapshotType: PROPERTY_EVIDENCE_SYNTHESIS_SNAPSHOT,
    payload: { ...property, generatedAt: null },
    completeness: {
      established: property.diligence.filter((topic) => topic.status === 'established').length,
      topics: property.diligence.length,
      claims: property.recordFacts.length,
      conflicts: property.conflicts.length,
      guardrails: property.guardrails.length,
      visualReview: property.visualReview.length,
    },
    changeReason: `Property evidence synthesis: ${property.story.headline}`,
    actor,
    auditEvent: 'landos.property_evidence_synthesis.write',
    capabilityId: PROPERTY_EVIDENCE_SYNTHESIS_SKILL,
    runId: deps.runId ?? null,
  });

  const marketWrite = write({
    dealCardId,
    snapshotType: MARKET_RESEARCH_PULSE_SNAPSHOT,
    payload: { ...market, generatedAt: null },
    completeness: {
      subjectBandAvailable: market.subjectBand.available,
      bandUsed: market.subjectBand.bandUsed,
      sampleCount: market.subjectBand.sampleCount,
      ladderRungs: market.bandLadder.length,
      pulsePlanned: market.pulsePlan.filter((entry) => entry.status === 'planned').length,
      pulseClaims: market.pulseClaims.length,
    },
    changeReason: `Market research and pulse: ${market.story.headline}`,
    actor,
    auditEvent: 'landos.market_research_pulse.write',
    capabilityId: MARKET_RESEARCH_PULSE_SKILL,
    runId: deps.runId ?? null,
  });

  const written = (propertyWrite.snapshotId != null && !propertyWrite.reused)
    || (marketWrite.snapshotId != null && !marketWrite.reused);

  return {
    outcome: written ? 'produced' : 'unchanged',
    stability,
    property,
    market,
    persistence: {
      property: {
        snapshotId: propertyWrite.snapshotId,
        written: propertyWrite.snapshotId != null && !propertyWrite.reused,
        skippedReason: propertyWrite.skippedReason,
      },
      market: {
        snapshotId: marketWrite.snapshotId,
        written: marketWrite.snapshotId != null && !marketWrite.reused,
        skippedReason: marketWrite.skippedReason,
      },
    },
    sellerIntelligence: stability.sellerIntelligence,
  };
}

/**
 * PURE SELECT. Why there is, or is not, a reading to show.
 *
 * A read-only surface still owes the operator an explanation for an empty
 * panel, and it must be able to give one without writing anything. This runs
 * the same stability assessment the producer runs and stops there — it never
 * builds, never persists, and never supersedes.
 */
export function readResearchStability(
  dealCardId: number,
  deps: Pick<ResearchStableIntelligenceDeps, 'readPropertyFile' | 'readSubject' | 'readUnderstanding'>,
): ResearchStability | null {
  const source = deps.readPropertyFile(dealCardId);
  if (!source) return null;
  return assessResearchStability({
    subject: (deps.readSubject ?? resolveCanonicalSubjectState)(dealCardId),
    understanding: (deps.readUnderstanding ?? readSubjectUnderstanding)(dealCardId),
    dossier: buildAcquisitionDossier(source),
  });
}

// ── Reading them back ───────────────────────────────────────────────────────

export interface RetainedReading<T> {
  value: T;
  /** Whether the retained reading is still about the accepted parcel. */
  correlation: ParcelCorrelation;
  /** When the row was retained. The payload's own `generatedAt` is null by
   *  design; see the write above. */
  retainedAt: string | null;
}

function readRetainedReading<T>(dealCardId: number, snapshotType: string): RetainedReading<T> | null {
  const read = readDerivedSnapshotForParcel<T>(dealCardId, snapshotType);
  if (!read) return null;
  const row = getLandosDb().prepare(`
    SELECT created_at FROM landos_deal_intelligence_snapshot
    WHERE deal_card_id=? AND snapshot_type=? AND status='current' LIMIT 1
  `).get(dealCardId, snapshotType) as { created_at: number } | undefined;
  return {
    value: read.value,
    correlation: read.correlation,
    retainedAt: row?.created_at ? new Date(row.created_at * 1000).toISOString() : null,
  };
}

/** The current retained Property Story, with its parcel correlation. */
export function readPropertyEvidenceSynthesis(
  dealCardId: number,
): RetainedReading<PropertyEvidenceSynthesis> | null {
  return readRetainedReading<PropertyEvidenceSynthesis>(dealCardId, PROPERTY_EVIDENCE_SYNTHESIS_SNAPSHOT);
}

/** The current retained Market Story, with its parcel correlation. */
export function readMarketResearchAndPulse(
  dealCardId: number,
): RetainedReading<MarketResearchAndPulse> | null {
  return readRetainedReading<MarketResearchAndPulse>(dealCardId, MARKET_RESEARCH_PULSE_SNAPSHOT);
}
