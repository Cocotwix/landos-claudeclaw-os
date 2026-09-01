// LandOS — Subject Understanding, wired to the live Deal.
//
// `subject-understanding.ts` is the pure contract and the bounded loop.
// This file is the placement over what LandOS already holds:
//
//   assemble  — read every retained source that speaks about the subject and
//               turn it into typed evidence with its provenance intact. Every
//               reader here already existed; none of them is re-implemented.
//   run       — the bounded loop, with the reasoning turn bound to the
//               persistent `landos-property` specialist on the `clarify`
//               toolset, which structurally cannot browse, search, run a
//               command or write a file. It returns directions; LandOS acts.
//   persist   — one current derived read through the SHARED derived-snapshot
//               seam, superseded rather than overwritten, correlated to the
//               subject version it answered about.
//
// It never writes canonical identity. Promotion stays with the resolution path
// that already owns it: this establishes what LandOS UNDERSTANDS the lead to
// be, records it with its evidence, and leaves the accepted subject alone.

import {
  type CapabilityExecutionEnvironment,
  type CapabilityExecutionOutcome,
  type CapabilityInvocationRequest,
  type JsonObject,
  type LandosCapability,
  type SubjectResolutionState,
} from './capability-contract.js';
import { getDealCard, resolveSubjectPropertyCard } from './deal-card.js';
import { getPropertyCardRow } from './property-card.js';
import { classifySmartIntake } from './intake-router.js';
import {
  interpretDealEvidence,
  type RetainedEvidenceArtifact,
} from './deal-evidence-claims.js';
import { loadDealWorkingState, loadRetainedEvidenceArtifacts } from './deal-evidence-claims-store.js';
import { documentEvidenceFacts } from './document-evidence.js';
import { getOperatorParcelContext, retainedParcelRecords } from './deal-parcel-scope-view.js';
import { sameApn } from './parcel-scope-context.js';
import { resolveCanonicalSubjectState, type CanonicalSubjectState } from './canonical-subject-state.js';
import { readDerivedSnapshot, writeDerivedSnapshot } from './derived-intelligence-store.js';
import { createSubjectUnderstandingPlanner, type SubjectPlannerDeps } from './subject-understanding-planner.js';
import { promoteUnderstoodSubject, type SubjectPromotion } from './subject-promotion.js';
import {
  SUBJECT_UNDERSTANDING_ALLOWED_CAPABILITIES,
  understandSubject,
  type SubjectEvidenceExecutor,
  type SubjectEvidenceFact,
  type SubjectEvidenceField,
  type SubjectEvidenceKind,
  type SubjectUnderstandingPlanner,
  type SubjectUnderstandingResult,
} from './subject-understanding.js';

export const SUBJECT_UNDERSTANDING_CAPABILITY_ID = 'subject-understanding';
export const SUBJECT_UNDERSTANDING_SNAPSHOT = 'subject_understanding_v1';
export const SUBJECT_UNDERSTANDING_SKILL = 'landos-subject-understanding';

// ── Assembling the evidence ─────────────────────────────────────────────────

interface FactSeed {
  field: SubjectEvidenceField;
  label: string;
  value: string | null | undefined;
  quoted: string | null;
  inferred: boolean;
  kind: SubjectEvidenceKind;
  sourceLabel: string;
  locator: string | null;
  url?: string | null;
  officiality?: 'official' | 'officially_linked' | 'unverified';
  weight?: SubjectEvidenceFact['weight'];
  relationship?: SubjectEvidenceFact['parcelRelationship'];
}

function seedFact(prefix: string, index: number, seed: FactSeed): SubjectEvidenceFact | null {
  const value = String(seed.value ?? '').trim();
  if (value === '' || value === '-') return null;
  return {
    factId: `${prefix}:${index}:${seed.field}`,
    field: seed.field,
    label: seed.label,
    value,
    quoted: seed.quoted,
    inferred: seed.inferred,
    source: {
      kind: seed.kind,
      label: seed.sourceLabel,
      url: seed.url ?? null,
      locator: seed.locator,
      retrievedAt: null,
      officiality: seed.officiality ?? 'unverified',
    },
    weight: seed.weight ?? 'well_supported',
    parcelRelationship: seed.relationship ?? 'subject',
  };
}

/**
 * Did the operator actually write this, or did LandOS work it out?
 *
 * The parser returns normalized values with no memory of whether the words were
 * on the page. Checking the retained raw text is the cheapest honest answer,
 * and it is what keeps a derived county from presenting as a seller statement.
 */
function quotedIn(raw: string, value: string): string | null {
  const needle = value.trim();
  if (needle.length < 2) return null;
  const at = raw.toLowerCase().indexOf(needle.toLowerCase());
  return at === -1 ? null : raw.slice(at, at + needle.length);
}

export interface LeadEvidenceSources {
  rawIntake: string;
  subject: CanonicalSubjectState;
  artifacts: RetainedEvidenceArtifact[];
  workingState: { apn: string | null; owner: string | null; acreage: number | null; roadName: string | null; county: string | null };
  operatorContext: { statement: string; clusterApns: string[]; adjoiningManufacturedHome: boolean } | null;
  retainedParcels: Array<{ apn: string; owner: string | null; acres: number | null; buildingSqft: number | null }>;
}

/**
 * PURE. Every retained source, as one typed evidence set.
 *
 * Deterministic parsers contribute CANDIDATES here, not conclusions: the same
 * `classifySmartIntake` that used to decide the lead now supplies fields that
 * carry their own weight and provenance and compete on it.
 */
export function buildLeadEvidence(sources: LeadEvidenceSources): SubjectEvidenceFact[] {
  const facts: SubjectEvidenceFact[] = [];
  const push = (fact: SubjectEvidenceFact | null) => { if (fact) facts.push(fact); };

  // 1. The canonical subject, when one is already accepted. Strongest first, so
  //    an accepted parcel is never displaced by a parse of the same text.
  const subject = sources.subject;
  const official = subject.officiallyVerified;
  const subjectSeeds: Array<[SubjectEvidenceField, string, string | null]> = [
    ['apn', 'Accepted parcel identifier', subject.apn],
    ['address', 'Accepted situs address', subject.address],
    ['city', 'Accepted city', subject.city],
    ['county', 'Accepted county', subject.county],
    ['state', 'Accepted state', subject.state],
    ['zip', 'Accepted ZIP', subject.zip],
    ['fips', 'Accepted county FIPS', subject.fips],
    ['owner', 'Owner of record', subject.owner],
  ];
  if (subject.subjectResolved) {
    subjectSeeds.forEach(([field, label, value], index) => push(seedFact('canonical', index, {
      field, label, value, quoted: null, inferred: false,
      kind: official ? 'official_record' : 'provider_record',
      // The official record's OWN name, so the panel can print the record it
      // is claiming rather than the claim alone.
      sourceLabel: official
        ? subject.officialVerificationSource ?? 'Accepted official parcel record'
        : `Accepted LandOS subject (${subject.source})`,
      locator: subject.apn ? `parcel ${subject.apn}` : subject.subjectVersion,
      officiality: official ? 'official' : 'officially_linked',
      weight: official ? 'confirmed' : 'well_supported',
    })));
    if (subject.governingAcreage.value != null) {
      push(seedFact('canonical', 99, {
        field: 'acreage',
        label: `Governing acreage (${subject.governingAcreage.kind ?? 'basis not stated'})`,
        value: String(subject.governingAcreage.value),
        quoted: null,
        inferred: true,
        kind: official ? 'official_record' : 'provider_record',
        sourceLabel: subject.governingAcreage.source ?? 'LandOS governing acreage basis',
        locator: subject.subjectVersion,
        officiality: official ? 'official' : 'unverified',
        weight: 'well_supported',
      }));
    }
  }

  // 2. Deterministic extraction over the operator's own words.
  const raw = sources.rawIntake.trim();
  if (raw !== '') {
    const parsed = classifySmartIntake(raw).parsedFields;
    const seeds: Array<[SubjectEvidenceField, string, string | undefined]> = [
      ['apn', 'Parcel number read from the lead', parsed.apn],
      ['address', 'Address read from the lead', parsed.address],
      ['city', 'City read from the lead', parsed.city],
      ['county', 'County read from the lead', parsed.county],
      ['state', 'State read from the lead', parsed.state],
      ['zip', 'ZIP read from the lead', parsed.zip],
      ['fips', 'County FIPS read from the lead', parsed.fips],
      ['owner', 'Name read from the lead', parsed.owner],
      ['lp_property_id', 'LandPortal property id in the supplied link', parsed.propertyId],
      ['lp_url', 'LandPortal link the operator supplied', parsed.lpUrl],
    ];
    seeds.forEach(([field, label, value], index) => {
      const text = String(value ?? '').trim();
      if (!text) return;
      const quoted = quotedIn(raw, text);
      push(seedFact('intake', index, {
        field, label, value: text,
        quoted,
        inferred: quoted === null,
        kind: field === 'lp_url' || field === 'lp_property_id' ? 'landportal_link' : 'seller_text',
        sourceLabel: 'Lead intake text',
        locator: 'Retained raw intake',
        url: field === 'lp_url' ? text : parsed.lpUrl ?? null,
        officiality: field === 'lp_url' || field === 'lp_property_id' ? 'officially_linked' : 'unverified',
        // A parse is a candidate. It never outranks an accepted record or a
        // recorded instrument, and saying so here is what makes that true.
        weight: quoted === null ? 'likely' : 'well_supported',
      }));
    });
    // The operator's own words, whole, so the reasoning turn sees the lead as
    // written and not only as parsed.
    push(seedFact('intake', 90, {
      field: 'other', label: 'Lead as the operator wrote it', value: raw.slice(0, 2000),
      quoted: raw.slice(0, 2000), inferred: false,
      kind: 'seller_text', sourceLabel: 'Lead intake text', locator: 'Retained raw intake',
      weight: 'likely',
    }));
  }

  // 3. Documents, through the existing document path.
  if (sources.artifacts.length > 0) {
    const interpretation = interpretDealEvidence({
      artifacts: sources.artifacts,
      state: sources.workingState,
    });
    facts.push(...documentEvidenceFacts({ interpretation, artifacts: sources.artifacts }));
  }

  // 4. The operator's spatial narrative. This is the only source that routinely
  //    states SCOPE — which lots are held, which one is being sold, what stays.
  if (sources.operatorContext) {
    push(seedFact('operator', 0, {
      field: 'other', label: 'Operator-confirmed holding and scope',
      value: sources.operatorContext.statement,
      quoted: sources.operatorContext.statement, inferred: false,
      kind: 'operator_narrative', sourceLabel: 'Operator note', locator: 'Deal parcel context',
      weight: 'well_supported',
    }));
  }

  // 5. Parcels a research sweep retained beside the subject. Labelled, never
  //    merged: invariant 4 lives or dies on this branch.
  const subjectApn = subject.apn ?? sources.workingState.apn;
  sources.retainedParcels.forEach((parcel, index) => {
    if (subjectApn && sameApn(parcel.apn, subjectApn)) return;
    const base = 200 + index * 4;
    push(seedFact('retained', base, {
      field: 'apn', label: 'Parcel retained beside the subject', value: parcel.apn,
      quoted: parcel.apn, inferred: false, kind: 'provider_record',
      sourceLabel: 'Retained provider parcel record', locator: `Parcel ${parcel.apn}`,
      relationship: 'related_parcel', weight: 'likely',
    }));
    push(seedFact('retained', base + 1, {
      field: 'acreage', label: 'Acreage of the retained parcel', value: parcel.acres == null ? null : String(parcel.acres),
      quoted: null, inferred: false, kind: 'provider_record',
      sourceLabel: 'Retained provider parcel record', locator: `Parcel ${parcel.apn}`,
      relationship: 'related_parcel', weight: 'likely',
    }));
    push(seedFact('retained', base + 2, {
      field: 'owner', label: 'Owner shown on the retained parcel', value: parcel.owner,
      quoted: parcel.owner, inferred: false, kind: 'provider_record',
      sourceLabel: 'Retained provider parcel record', locator: `Parcel ${parcel.apn}`,
      relationship: 'related_parcel', weight: 'likely',
    }));
    if (parcel.buildingSqft != null && parcel.buildingSqft > 0) {
      push(seedFact('retained', base + 3, {
        field: 'improvement', label: 'Improvement on the retained parcel',
        value: `${parcel.buildingSqft} sq ft of building`,
        quoted: null, inferred: false, kind: 'provider_record',
        sourceLabel: 'Retained provider parcel record', locator: `Parcel ${parcel.apn}`,
        relationship: 'related_parcel', weight: 'likely',
      }));
    }
  });

  return facts;
}

/** Read every live source this Deal carries. */
export function readLeadEvidenceSources(dealCardId: number): LeadEvidenceSources {
  const deal = getDealCard(dealCardId);
  const cardId = deal ? resolveSubjectPropertyCard(deal).cardId : null;
  const card = cardId == null ? null : getPropertyCardRow(cardId);
  const notes = String((deal as { seller_notes?: string } | null)?.seller_notes ?? '').trim();
  const summary = String((card as { summary?: string } | null)?.summary ?? '').trim();
  const working = loadDealWorkingState(dealCardId);
  return {
    rawIntake: [notes, summary].filter((value) => value !== '').join('\n\n'),
    subject: resolveCanonicalSubjectState(dealCardId),
    artifacts: loadRetainedEvidenceArtifacts(dealCardId),
    workingState: {
      apn: working.apn, owner: working.owner, acreage: working.acreage,
      roadName: working.roadName, county: working.county,
    },
    operatorContext: getOperatorParcelContext(dealCardId),
    retainedParcels: retainedParcelRecords(dealCardId),
  };
}

// ── Running it ──────────────────────────────────────────────────────────────

export interface SubjectUnderstandingRuntime {
  /**
   * Reasoning only. Omitted, the PRODUCTION planner is bound (the persistent
   * `landos-property` specialist on the tool-less `clarify` toolset). Pass
   * `null` to run deterministically with no model at all — which is what a
   * read-only page load does, because opening a Deal Card is not a fresh
   * subject decision and must not cost a model call.
   */
  planner?: SubjectUnderstandingPlanner | null;
  /** Injected in tests so the production binding never spawns. */
  plannerDeps?: SubjectPlannerDeps;
  /** Runs one authorized capability. Absent means no evidence check runs. */
  executor?: SubjectEvidenceExecutor;
  /** Injected in tests; production reads the live Deal. */
  readSources?: (dealCardId: number) => LeadEvidenceSources;
  actionLimit?: number;
  actor?: string;
  runId?: string | null;
  /** Skip the write; used by read-only previews. */
  persist?: boolean;
  /** Skip promotion through the Stage 1 accepted-subject path. Previews and
   *  the read-only GET set this; a real New Lead decision does not. */
  promote?: boolean;
}

export interface SubjectUnderstandingRun {
  result: SubjectUnderstandingResult;
  /** The subject version this reading answered about. */
  subjectVersion: string;
  persistence: { written: boolean; snapshotId: number | null; skippedReason: string | null };
  /** What the Stage 1 accepted-subject path did with this reading. */
  promotion: SubjectPromotion | null;
}

export async function runSubjectUnderstanding(
  dealCardId: number,
  runtime: SubjectUnderstandingRuntime = {},
): Promise<SubjectUnderstandingRun> {
  const sources = (runtime.readSources ?? readLeadEvidenceSources)(dealCardId);
  const subjectVersion = sources.subject.subjectVersion;

  // Bind the production LLM Deal Manager unless the caller supplied its own
  // planner or explicitly asked for none. `null` is the read-only path: a page
  // load is not a fresh subject decision.
  const binding = runtime.planner === undefined && runtime.persist !== false
    ? createSubjectUnderstandingPlanner(runtime.plannerDeps ?? {})
    : null;
  const planner = runtime.planner ?? binding?.planner ?? undefined;

  const result = await understandSubject({
    dealCardId,
    evidence: buildLeadEvidence(sources),
    subjectVersionAtStart: subjectVersion,
    planner: planner ?? undefined,
    plannerProvenance: binding?.provenance,
    executor: runtime.executor,
    actionLimit: runtime.actionLimit,
    // Re-read at the end: a subject that moved during the run refuses the write.
    currentSubjectVersion: runtime.readSources
      ? undefined
      : () => resolveCanonicalSubjectState(dealCardId).subjectVersion,
  });

  if (runtime.persist === false || !result.persistable) {
    return {
      result,
      subjectVersion,
      persistence: {
        written: false,
        snapshotId: null,
        skippedReason: result.persistable
          ? 'Preview only; the reading was not written.'
          : 'The accepted subject changed during this run, so the reading was retained but not written.',
      },
      promotion: null,
    };
  }

  const written = writeDerivedSnapshot({
    dealCardId,
    snapshotType: SUBJECT_UNDERSTANDING_SNAPSHOT,
    payload: { ...result, ranAgainstSubjectVersion: subjectVersion },
    completeness: {
      outcome: result.outcome,
      candidates: result.candidates.length,
      conflicts: result.conflicts.length,
      actionsUsed: result.audit.actionsUsed,
      stopReason: result.audit.stopReason,
    },
    changeReason: `Subject understanding: ${result.outcome} (${result.audit.stopReason})`,
    actor: runtime.actor ?? 'capability:subject-understanding',
    auditEvent: 'landos.subject_understanding.write',
    capabilityId: SUBJECT_UNDERSTANDING_CAPABILITY_ID,
    runId: runtime.runId ?? null,
  });

  // The snapshot is EVIDENCE and stays whole regardless of what follows.
  // Promotion is a separate decision made after it, through the Stage 1 writer
  // — never a rewrite of the reading, and never a second identity store.
  const promotion = runtime.promote === false
    ? null
    : promoteUnderstoodSubject({
        dealCardId,
        result,
        subjectVersionAtStart: subjectVersion,
        actor: runtime.actor ?? 'capability:subject-understanding',
      });

  return {
    result,
    subjectVersion,
    persistence: {
      written: written.snapshotId != null && !written.reused,
      snapshotId: written.snapshotId,
      skippedReason: written.skippedReason,
    },
    promotion,
  };
}

/** The current retained reading, or null. A pure SELECT. */
export function readSubjectUnderstanding(
  dealCardId: number,
): (SubjectUnderstandingResult & { ranAgainstSubjectVersion?: string }) | null {
  return readDerivedSnapshot<SubjectUnderstandingResult & { ranAgainstSubjectVersion?: string }>(
    dealCardId,
    SUBJECT_UNDERSTANDING_SNAPSHOT,
  );
}

// ── The capability ──────────────────────────────────────────────────────────

const RESOLUTION_STATE: Record<SubjectUnderstandingResult['outcome'], SubjectResolutionState> = {
  research_ready: 'RESOLVED',
  candidate_set: 'AMBIGUOUS',
  needs_targeted_input: 'UNRESOLVED',
};

export const SUBJECT_UNDERSTANDING_CAPABILITY: LandosCapability<JsonObject, SubjectUnderstandingRuntime> = {
  metadata: {
    id: SUBJECT_UNDERSTANDING_CAPABILITY_ID,
    name: 'Subject understanding',
    contractVersion: '1.0.0',
    description:
      'Interprets a New Lead\'s mixed evidence — seller text, form fields, documents, a supplied provider link, '
      + 'geometry, owner clues and the operator\'s spatial narrative — and returns a supported Working Acquisition '
      + 'Subject, a ranked candidate set, or exactly one targeted question.',
  },
  validate(request: CapabilityInvocationRequest): void {
    if (request.subject.kind === 'geography') {
      throw new Error('subject understanding answers about a lead, not a geography');
    }
  },
  async execute(
    request: CapabilityInvocationRequest,
    runtime: SubjectUnderstandingRuntime,
    environment: CapabilityExecutionEnvironment,
  ): Promise<CapabilityExecutionOutcome<JsonObject>> {
    const dealCardId = request.subject.kind === 'canonical_property'
      ? request.subject.dealCardId ?? 0
      : request.subject.kind === 'raw_property'
        ? request.subject.target?.dealCardId ?? 0
        : 0;
    if (!Number.isInteger(dealCardId) || dealCardId < 1) {
      throw new Error('subject understanding requires a Deal Card');
    }
    const run = await runSubjectUnderstanding(dealCardId, { ...runtime, runId: environment.invocationId });
    const { result } = run;
    return {
      status: result.outcome === 'needs_targeted_input' ? 'NEEDS_INPUT' : 'SUCCEEDED',
      subjectResolution: RESOLUTION_STATE[result.outcome],
      canonicalSubject: null,
      facts: {
        outcome: result.outcome,
        subject: (result.subject ?? null) as unknown as JsonObject,
        candidates: result.candidates as unknown as JsonObject[],
        conflicts: result.conflicts as unknown as JsonObject[],
        excludedParcels: result.excludedParcels as unknown as JsonObject[],
        question: (result.question ?? null) as unknown as JsonObject,
        audit: result.audit as unknown as JsonObject,
        persistence: run.persistence as unknown as JsonObject,
        promotion: (run.promotion ?? null) as unknown as JsonObject,
      } as unknown as JsonObject,
      evidence: result.evidence.map((fact) => ({
        source: fact.source.label,
        sourceUrl: fact.source.url,
        sourceType: fact.source.kind,
        retrievedAt: fact.source.retrievedAt ?? environment.startedAt,
        details: {
          field: fact.field,
          value: fact.value,
          quoted: fact.quoted,
          inferred: fact.inferred,
          weight: fact.weight,
          parcelRelationship: fact.parcelRelationship,
          locator: fact.source.locator,
        } as unknown as JsonObject,
      })),
      warnings: result.persistable ? [] : ['The accepted subject changed during this run; the reading was not written.'],
      missingInformation: result.question ? [result.question.question] : [],
    };
  },
};

export { SUBJECT_UNDERSTANDING_ALLOWED_CAPABILITIES };
