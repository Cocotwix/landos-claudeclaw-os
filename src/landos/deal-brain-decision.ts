// LandOS — the Deal Brain decision lifecycle.
//
// Stage 3 made research completing produce the Property Story and the Market
// Story. This module makes those two readings, plus whatever the seller has
// actually said, produce a DECISION — and keeps that decision honest over time.
//
// Two capabilities run here, in order, over one retained record:
//
//   landos-seller-discovery          the discovery brief and the seller claims,
//                                    drawn only from retained communications
//   landos-deal-decision-synthesis   the posture, the ranked risks, the exits,
//                                    the value guidance and the next actions
//
// and three rules govern when anything is written:
//
//   TRIGGERED, NOT POLLED   it runs on the Stage 3 completion boundary (every
//                           coverage-cycle close and subject transition) and
//                           on a seller-record event. Never on a read.
//   MATERIAL, NOT NOISY     a decision is superseded only when a MATERIAL
//                           dimension moved: seller, value, zoning, access,
//                           title, strategy, subject or market. A story that
//                           re-rendered with the same substance writes nothing.
//   EXPLAINED               every refreshed decision names the cause and the
//                           exact dimensions that changed, before → after, so
//                           the operator sees what new evidence moved it.
//
// Both products persist through the shared derived-snapshot seam: attached to
// the current identity version, deduped on the input hash, superseded rather
// than overwritten, and rejected when the originating run lost authority.
// Reading back correlates against the accepted parcel exactly as Stage 3 does,
// so a decision formed about another parcel version is history, not truth.

import { buildAcquisitionDossier, type PropertyFileSource } from './acquisition-intelligence-dossier.js';
import { getAcquisition, type AcquisitionState } from './acquisitions.js';
import { resolveCanonicalSubjectState, type CanonicalSubjectState } from './canonical-subject-state.js';
import {
  buildDealDecisionSynthesis,
  DEAL_DECISION_SKILL,
  DEAL_DECISION_SNAPSHOT,
  DEAL_DECISION_SYNTHESIS_VERSION,
  type DealDecisionSynthesis,
  type IdentityEvidenceInput,
} from './deal-decision-synthesis.js';
import { getLandosDb } from './db.js';
import {
  readDerivedSnapshotForParcel,
  writeDerivedSnapshot,
  type ParcelCorrelation,
} from './derived-intelligence-store.js';
import type { MarketResearchAndPulse } from './market-research-and-pulse.js';
import type { PropertyEvidenceSynthesis } from './property-evidence-synthesis.js';
import {
  PROPERTY_EVIDENCE_SYNTHESIS_SNAPSHOT,
  readMarketResearchAndPulse,
  readPropertyEvidenceSynthesis,
  stage3ArtifactStatus,
  type RetainedReading,
  type Stage3ArtifactStatusView,
} from './research-stable-intelligence.js';
import {
  buildSellerDiscovery,
  SELLER_DISCOVERY_SKILL,
  SELLER_DISCOVERY_SNAPSHOT,
  type SellerDiscoverySynthesis,
} from './seller-discovery.js';
import { loadSellerStatedFacts, type SellerStatedFact } from './seller-stated-facts.js';

// ── What a refreshed decision carries about its own refresh ────────────────

export interface DecisionChange {
  dimension: string;
  before: string | null;
  after: string;
}

export interface DecisionRefresh {
  /** The lifecycle event that formed this version, e.g. `coverage:operator`
   *  or `seller:communication_added`. */
  cause: string;
  /** Material dimensions that moved since the prior current decision. Empty
   *  on the first decision. */
  changes: DecisionChange[];
  priorSnapshotId: number | null;
  /** `initial` for the first decision; `material` when a dimension moved;
   *  `contract` when a newer decision contract re-formed an unchanged record. */
  kind: 'initial' | 'material' | 'contract';
}

/** The persisted decision: the synthesis plus what it was formed on. */
export interface RetainedDealDecision extends DealDecisionSynthesis {
  basedOn: {
    propertySnapshotId: number | null;
    marketSnapshotId: number | null;
    sellerDiscoverySnapshotId: number | null;
    subjectVersion: string | null;
  };
  /** The one shared status of each Stage 3 input, from the same mapping the
   *  Overview cards read. A pending or historical artifact is named as such
   *  and is never presented as a current story. */
  inputs: {
    property: Stage3ArtifactStatusView;
    market: Stage3ArtifactStatusView;
  };
  refresh: DecisionRefresh;
}

/** The retained record behind the subject's parcel identity. A SELECT. */
export function readIdentityEvidence(propertyCardId: number | null): IdentityEvidenceInput | null {
  if (propertyCardId == null) return null;
  const db = getLandosDb();
  const card = db.prepare(
    'SELECT id, verification_status, verification_source, apn, county, state, fips FROM landos_property_card WHERE id = ?',
  ).get(propertyCardId) as { id: number; verification_status: string | null; verification_source: string | null; apn: string | null; county: string | null; state: string | null; fips: string | null } | undefined;
  if (!card) return null;
  const rows = db.prepare(
    'SELECT id, fact, source_url, date_accessed, note FROM landos_card_source_evidence WHERE card_id = ? ORDER BY created_at DESC, id DESC',
  ).all(propertyCardId) as Array<{ id: number; fact: string; source_url: string; date_accessed: string; note: string }>;
  return {
    propertyCardId: card.id,
    verificationStatus: card.verification_status,
    verificationSource: card.verification_source,
    apn: card.apn,
    county: card.county,
    state: card.state,
    fips: card.fips || null,
    records: rows.map((row) => ({
      recordId: `property card ${card.id} · source evidence #${row.id}`,
      fact: row.fact,
      sourceUrl: row.source_url || null,
      accessedAt: row.date_accessed || null,
      note: row.note || null,
    })),
  };
}

// ── Dependencies ────────────────────────────────────────────────────────────

export interface FreshStories {
  property: PropertyEvidenceSynthesis;
  market: MarketResearchAndPulse;
  propertySnapshotId: number | null;
  marketSnapshotId: number | null;
}

export interface DealBrainDecisionDeps {
  readPropertyFile: (dealCardId: number) => PropertyFileSource | null;
  readSubject?: (dealCardId: number) => CanonicalSubjectState;
  readAcquisition?: (dealCardId: number) => AcquisitionState;
  readSellerStatedFacts?: (propertyCardId: number) => SellerStatedFact[];
  readIdentityEvidence?: (propertyCardId: number | null) => IdentityEvidenceInput | null;
  readPropertyStory?: (dealCardId: number) => RetainedReading<PropertyEvidenceSynthesis> | null;
  readMarketStory?: (dealCardId: number) => RetainedReading<MarketResearchAndPulse> | null;
  readCurrentDecision?: (dealCardId: number) => RetainedReading<RetainedDealDecision> | null;
  writeSnapshot?: typeof writeDerivedSnapshot;
  /** Readings the caller has just formed, so the completion boundary does not
   *  re-read what it wrote a moment ago. */
  stories?: FreshStories | null;
  /** The lifecycle event, recorded on the decision. */
  cause: string;
  actor?: string;
  runId?: string | null;
}

export interface DealBrainDecisionResult {
  outcome: 'produced' | 'unchanged' | 'awaiting_intelligence' | 'no_property_file';
  /** Why nothing was formed, when nothing was. */
  reason: string | null;
  decision: RetainedDealDecision | null;
  sellerDiscovery: SellerDiscoverySynthesis | null;
  persistence: {
    decision: { snapshotId: number | null; written: boolean; skippedReason: string | null };
    sellerDiscovery: { snapshotId: number | null; written: boolean; skippedReason: string | null };
  };
  changes: DecisionChange[];
}

/** PURE. The material dimensions that moved between two decisions. */
export function diffMaterialDimensions(
  prior: Record<string, string> | null | undefined,
  next: Record<string, string>,
): DecisionChange[] {
  const changes: DecisionChange[] = [];
  for (const [dimension, after] of Object.entries(next)) {
    const before = prior?.[dimension] ?? null;
    if (before !== after) changes.push({ dimension, before, after });
  }
  return changes;
}

// ── Producing the decision ──────────────────────────────────────────────────

/**
 * Form and persist the seller discovery and the decision, when there is a
 * settled reading to decide on.
 *
 * Safe on any trigger: unchanged evidence writes nothing, an immaterial story
 * change writes nothing, and only a moved material dimension supersedes the
 * current decision — with the change recorded on the new version.
 */
export function ensureDealBrainDecision(
  dealCardId: number,
  deps: DealBrainDecisionDeps,
): DealBrainDecisionResult {
  const empty = {
    decision: { snapshotId: null, written: false, skippedReason: null },
    sellerDiscovery: { snapshotId: null, written: false, skippedReason: null },
  };
  const source = deps.readPropertyFile(dealCardId);
  if (!source) {
    return { outcome: 'no_property_file', reason: 'No canonical property file exists for this Deal Card.', decision: null, sellerDiscovery: null, persistence: empty, changes: [] };
  }

  // The two readings this decision is formed on. Fresh ones from the
  // completion boundary win; otherwise the retained current ones, and only
  // when they are still about the accepted parcel.
  let property: PropertyEvidenceSynthesis | null = null;
  let market: MarketResearchAndPulse | null = null;
  let propertySnapshotId: number | null = null;
  let marketSnapshotId: number | null = null;
  // The readings as retained, so the decision can carry the same status the
  // Overview cards show. Fresh readings from the completion boundary are, by
  // construction, current and correlated to the accepted subject.
  let propertyReading: RetainedReading<PropertyEvidenceSynthesis> | null = null;
  let marketReading: RetainedReading<MarketResearchAndPulse> | null = null;
  if (deps.stories) {
    property = deps.stories.property;
    market = deps.stories.market;
    propertySnapshotId = deps.stories.propertySnapshotId;
    marketSnapshotId = deps.stories.marketSnapshotId;
    propertyReading = { value: property, correlation: 'equivalent', retainedAt: null, snapshotId: propertySnapshotId };
    marketReading = { value: market, correlation: 'equivalent', retainedAt: null, snapshotId: marketSnapshotId };
  } else {
    propertyReading = (deps.readPropertyStory ?? readPropertyEvidenceSynthesis)(dealCardId);
    marketReading = (deps.readMarketStory ?? readMarketResearchAndPulse)(dealCardId);
    if (propertyReading?.correlation === 'equivalent') {
      property = propertyReading.value;
      propertySnapshotId = propertyReading.snapshotId;
    }
    if (marketReading?.correlation === 'equivalent') {
      market = marketReading.value;
      marketSnapshotId = marketReading.snapshotId;
    }
  }
  if (!property) {
    return {
      outcome: 'awaiting_intelligence',
      reason: 'No current Property Story is retained for the accepted subject, so there is no settled reading to decide on yet.',
      decision: null,
      sellerDiscovery: null,
      persistence: empty,
      changes: [],
    };
  }

  const dossier = buildAcquisitionDossier(source);
  const subject = (deps.readSubject ?? resolveCanonicalSubjectState)(dealCardId);
  const acquisition = (deps.readAcquisition ?? getAcquisition)(dealCardId);
  const propertyCardId = source.propertyCardId ?? dossier.propertyCardId ?? null;
  const statedFacts = propertyCardId != null ? (deps.readSellerStatedFacts ?? loadSellerStatedFacts)(propertyCardId) : [];
  const people = (source.dealCard as { people?: Array<{ name?: string | null; phone?: string | null; email?: string | null }> } | undefined)?.people ?? [];

  const sellerDiscovery = buildSellerDiscovery({
    dealCardId,
    acquisition,
    sellerStatedFacts: statedFacts,
    property,
    market,
    askingPrice: dossier.seller.askingPrice,
    people,
  });

  const write = deps.writeSnapshot ?? writeDerivedSnapshot;
  const actor = deps.actor ?? 'capability:deal-brain-decision';

  // `generatedAt` stays null in the persisted payload for the same reason the
  // Stage 3 readings hold it null: the seam hashes the payload, and a
  // wall-clock inside it would make every trigger a "new" reading.
  const sellerWrite = write({
    dealCardId,
    snapshotType: SELLER_DISCOVERY_SNAPSHOT,
    payload: sellerDiscovery,
    completeness: {
      status: sellerDiscovery.status,
      planned: sellerDiscovery.planning.planned,
      communications: sellerDiscovery.record.communications,
      claims: sellerDiscovery.claims.length,
      unanswered: sellerDiscovery.unanswered.length,
      questions: sellerDiscovery.brief.questions.length,
    },
    changeReason: `Seller discovery: ${sellerDiscovery.status.replace(/_/g, ' ')}, ${sellerDiscovery.claims.length} claim(s), ${sellerDiscovery.brief.questions.filter((question) => !question.answeredBy.length).length} open question(s)`,
    actor,
    auditEvent: 'landos.seller_discovery.write',
    capabilityId: SELLER_DISCOVERY_SKILL,
    runId: deps.runId ?? null,
  });

  const synthesis = buildDealDecisionSynthesis({
    dealCardId,
    dossier,
    subject,
    property,
    market,
    sellerDiscovery,
    identityEvidence: (deps.readIdentityEvidence ?? readIdentityEvidence)(propertyCardId),
  });
  const inputs: RetainedDealDecision['inputs'] = {
    property: stage3ArtifactStatus('property_story', propertyReading, { dealCardId, consumedSnapshotId: propertySnapshotId, subjectVersion: subject.subjectVersion }),
    market: stage3ArtifactStatus('market_story', marketReading, { dealCardId, consumedSnapshotId: marketSnapshotId, subjectVersion: subject.subjectVersion }),
  };

  // The material gate. A prior decision about THIS parcel with the same
  // material fingerprint stands; nothing is written and nothing is superseded.
  // A decision formed under an older contract is the one exception: its shape
  // is no longer what the surfaces read, so it is re-formed and kept as history.
  const prior = (deps.readCurrentDecision ?? readDealBrainDecision)(dealCardId);
  const priorStands = prior?.correlation === 'equivalent';
  const priorContractCurrent = prior?.value.contractVersion === DEAL_DECISION_SYNTHESIS_VERSION;
  // Changes are reported only against a prior decision about this parcel. An
  // initial decision has nothing to have moved from, and listing every
  // dimension as "unknown → …" would bury the one refresh that matters.
  const changes = priorStands ? diffMaterialDimensions(prior!.value.materialDimensions, synthesis.materialDimensions) : [];
  if (priorStands && priorContractCurrent && prior!.value.materialFingerprint === synthesis.materialFingerprint) {
    return {
      outcome: 'unchanged',
      reason: 'No material seller, value, zoning, access, title, strategy, subject or market evidence changed; the current decision stands.',
      decision: prior!.value,
      sellerDiscovery,
      persistence: {
        decision: { snapshotId: prior!.snapshotId, written: false, skippedReason: 'no material change' },
        sellerDiscovery: { snapshotId: sellerWrite.snapshotId, written: sellerWrite.snapshotId != null && (!sellerWrite.reused || sellerWrite.reinstated === true), skippedReason: sellerWrite.skippedReason },
      },
      changes: [],
    };
  }

  const decision: RetainedDealDecision = {
    ...synthesis,
    basedOn: {
      propertySnapshotId,
      marketSnapshotId,
      sellerDiscoverySnapshotId: sellerWrite.snapshotId,
      subjectVersion: subject.subjectVersion,
    },
    inputs,
    refresh: {
      cause: deps.cause,
      changes,
      priorSnapshotId: priorStands ? prior!.snapshotId : null,
      kind: !priorStands ? 'initial' : changes.length ? 'material' : 'contract',
    },
  };

  const decisionWrite = write({
    dealCardId,
    snapshotType: DEAL_DECISION_SNAPSHOT,
    payload: decision,
    completeness: {
      mode: decision.mode,
      recommendation: decision.recommendation.kind,
      sufficient: decision.evidence.filter((row) => row.status === 'sufficient').length,
      required: decision.evidence.filter((row) => row.requiredForOffer).length,
      risks: decision.risks.length,
      opportunities: decision.opportunities.length,
      strategies: decision.exitStrategies.length,
      valueSupported: decision.value.status === 'supported',
      sellerStatus: decision.seller.status,
      changes: changes.length,
    },
    changeReason: `Deal decision (${decision.refresh.kind}, ${deps.cause}): ${decision.recommendation.statement}`,
    actor,
    auditEvent: 'landos.deal_decision.write',
    capabilityId: DEAL_DECISION_SKILL,
    runId: deps.runId ?? null,
  });

  const written = decisionWrite.snapshotId != null && (!decisionWrite.reused || decisionWrite.reinstated === true);
  return {
    outcome: written ? 'produced' : 'unchanged',
    reason: written ? null : decisionWrite.skippedReason ?? 'An identical decision is already retained.',
    decision,
    sellerDiscovery,
    persistence: {
      decision: { snapshotId: decisionWrite.snapshotId, written, skippedReason: decisionWrite.skippedReason },
      sellerDiscovery: { snapshotId: sellerWrite.snapshotId, written: sellerWrite.snapshotId != null && (!sellerWrite.reused || sellerWrite.reinstated === true), skippedReason: sellerWrite.skippedReason },
    },
    changes,
  };
}

// ── Settled intelligence without a decision ─────────────────────────────────

/**
 * Deal Cards holding a current Property Story and no current decision.
 *
 * The trigger for a decision is a STATE — settled intelligence — not the
 * event that happened to produce it. A story that settled before this
 * lifecycle existed, or while the runtime was down, is exactly as settled as
 * one that settled a moment ago, and the operator's Deal Brain must not stay
 * blank until the next unrelated research event. The runtime reconciles this
 * set once on start; the material gate keeps it idempotent. A SELECT.
 */
export function listDealsAwaitingDecision(): number[] {
  // A current decision formed under an older contract counts as awaiting: its
  // shape is not what the surfaces read, and the gate re-forms it as history.
  const rows = getLandosDb().prepare(`
    SELECT DISTINCT s.deal_card_id AS id
    FROM landos_deal_intelligence_snapshot s
    WHERE s.snapshot_type = ? AND s.status = 'current'
      AND NOT EXISTS (
        SELECT 1 FROM landos_deal_intelligence_snapshot d
        WHERE d.deal_card_id = s.deal_card_id AND d.snapshot_type = ? AND d.status = 'current'
          AND json_extract(d.summary_json, '$.contractVersion') = ?
      )
    ORDER BY s.deal_card_id
  `).all(PROPERTY_EVIDENCE_SYNTHESIS_SNAPSHOT, DEAL_DECISION_SNAPSHOT, DEAL_DECISION_SYNTHESIS_VERSION) as Array<{ id: number }>;
  return rows.map((row) => row.id);
}

// ── Reading back ────────────────────────────────────────────────────────────

function readRetained<T>(dealCardId: number, snapshotType: string): RetainedReading<T> | null {
  const read = readDerivedSnapshotForParcel<T>(dealCardId, snapshotType);
  if (!read) return null;
  const row = getLandosDb().prepare(`
    SELECT id, created_at FROM landos_deal_intelligence_snapshot
    WHERE deal_card_id=? AND snapshot_type=? AND status='current' LIMIT 1
  `).get(dealCardId, snapshotType) as { id: number; created_at: number } | undefined;
  return {
    value: read.value,
    correlation: read.correlation as ParcelCorrelation,
    retainedAt: row?.created_at ? new Date(row.created_at * 1000).toISOString() : null,
    snapshotId: row?.id ?? null,
  };
}

/** The current retained decision, with its parcel correlation. A SELECT. */
export function readDealBrainDecision(dealCardId: number): RetainedReading<RetainedDealDecision> | null {
  return readRetained<RetainedDealDecision>(dealCardId, DEAL_DECISION_SNAPSHOT);
}

/** The current retained seller discovery, with its parcel correlation. A SELECT. */
export function readSellerDiscovery(dealCardId: number): RetainedReading<SellerDiscoverySynthesis> | null {
  return readRetained<SellerDiscoverySynthesis>(dealCardId, SELLER_DISCOVERY_SNAPSHOT);
}

/**
 * Prior decisions, newest first, with the refresh record each one carried.
 * History for the operator: what the posture was, and what moved it.
 */
export function readDealBrainDecisionHistory(dealCardId: number, limit = 10): Array<{
  snapshotId: number;
  version: number;
  retainedAt: string | null;
  mode: RetainedDealDecision['mode'];
  recommendation: RetainedDealDecision['recommendation'];
  refresh: DecisionRefresh;
}> {
  const rows = getLandosDb().prepare(`
    SELECT id, version, created_at, summary_json FROM landos_deal_intelligence_snapshot
    WHERE deal_card_id=? AND snapshot_type=? AND status='superseded'
    ORDER BY version DESC LIMIT ?
  `).all(dealCardId, DEAL_DECISION_SNAPSHOT, limit) as Array<{ id: number; version: number; created_at: number; summary_json: string }>;
  const history: ReturnType<typeof readDealBrainDecisionHistory> = [];
  for (const row of rows) {
    try {
      const value = JSON.parse(row.summary_json) as RetainedDealDecision;
      history.push({
        snapshotId: row.id,
        version: row.version,
        retainedAt: row.created_at ? new Date(row.created_at * 1000).toISOString() : null,
        mode: value.mode,
        recommendation: value.recommendation,
        refresh: value.refresh,
      });
    } catch { /* an unreadable historical row is skipped, never fatal */ }
  }
  return history;
}
