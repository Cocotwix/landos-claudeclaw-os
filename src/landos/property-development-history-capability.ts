// LandOS — Property Development History Capability.
//
// This is a PLACEMENT, not a new investigation engine. The Property Backstory
// lane, the opportunistic discovered-context miner, the official-document
// intelligence store and its summariser all already exist and are accepted.
// This module is the runtime Capability envelope around them, so Tools, New
// Lead and the V2 Deal Card reach ONE property-history implementation through
// one contract.
//
// The question this capability answers is a PROPERTY question:
//
//     "What material government, planning and development history has surfaced
//      for THIS exact property?"
//
// That is why everything here is scoped to the canonical subject and why none
// of it is reusable jurisdiction truth. A rule package belongs to a government
// and is reused by every parcel it controls; a rezoning request belongs to one
// parcel and is never evidence about a neighbour. `zoning-subdivision` owns the
// first; this capability owns the second. They share search, official-document
// discovery, retrieval and evidence infrastructure — not business truth.
//
// ORDER OF OPERATIONS, and the order is the point:
//
//   1. CONSUME WHAT LANDOS ALREADY DISCOVERED. Property Resolution mines every
//      official document it downloads and retains the material passages it
//      finds about the subject; the zoning and subdivision lanes retain what
//      they read. `readDocumentIntelligence` and `readPropertyBackstory` are
//      SELECTs over exactly that, already anchored to this parcel.
//   2. Only then consider a BOUNDED targeted search, and only when the retained
//      context did not already establish material history. The bound is the
//      accepted lane's own budget; nothing here widens it.
//   3. Absence of a result is a valid result. "No material prior development or
//      entitlement history was established from the official sources searched"
//      is what LandOS returns, and it never claims no history exists.
//
// Hard rules carried over from the underlying implementation:
//   - The canonical subject comes from Property Resolution. This capability
//     never decides that a different parcel is the subject; on raw input it
//     delegates to the Property Resolution Capability and creates no lead,
//     Property Card or Deal Card of its own.
//   - REQUESTED zoning is not APPROVED zoning, a PROPOSED lot count is not an
//     ENTITLED one, and a recommendation is not a final approval. Each event
//     carries the status the record actually printed, and entitlement is
//     reported as established only where an authoritative approval says so.
//   - Roles stay distinct. An applicant or developer found in a planning
//     document is surfaced as an applicant or developer; it never overwrites
//     the CRM seller or contact, and this capability writes no CRM field.

import type {
  CanonicalSubjectReference,
  CapabilityEvidenceReference,
  CapabilityExecutionEnvironment,
  CapabilityExecutionOutcome,
  CapabilityInvocationRequest,
  CapabilityResult,
  JsonObject,
  LandosCapability,
  SubjectResolutionState,
} from './capability-contract.js';
import { getDealCard, getDealCardIdForPropertyCard } from './deal-card.js';
import { readDocumentIntelligence, type DocumentIntelligenceReadModel } from './official-document-intelligence-store.js';
import { readPropertyBackstory } from './property-backstory-store.js';
import { PROPERTY_RESOLUTION_CAPABILITY_ID } from './property-resolution-capability.js';
import { evaluateResolverIdentity, readResolverSubject } from './universal-property-resolution.js';
import type {
  BackstoryEventStatus,
  BackstoryEventType,
  PropertyBackstory,
  PropertyBackstoryEvent,
} from './property-backstory.js';

export const PROPERTY_DEVELOPMENT_HISTORY_CAPABILITY_ID = 'property-development-history';

/** The honest answer when a bounded search established nothing. */
export const NO_MATERIAL_HISTORY_STATEMENT =
  'No material prior development or entitlement history was established from the official sources searched.';

/**
 * The two existing execution paths, named.
 *
 * `retained_history` is the default because it is the path that answers for
 * every caller with no network at all: everything Property Resolution and the
 * land-use lanes already mined about this parcel is on disk and anchored to it.
 */
export type PropertyDevelopmentHistoryLane = 'retained_history' | 'research';

export type PropertyDevelopmentHistoryOutcome =
  | 'history_returned'
  | 'lane_completed'
  | 'no_material_history'
  | 'not_available';

/**
 * What the record SAID happened, kept separate from what was asked for.
 *
 * The four classes exist so no surface can collapse a request into an approval.
 */
export type HistoryStatusClass = 'request_or_proposal' | 'recommendation' | 'final_action' | 'stated';

const STATUS_CLASS: Record<BackstoryEventStatus, HistoryStatusClass> = {
  proposed: 'request_or_proposal',
  requested: 'request_or_proposal',
  recommended: 'recommendation',
  approved: 'final_action',
  denied: 'final_action',
  deferred: 'final_action',
  withdrawn: 'final_action',
  adopted: 'final_action',
  constructed: 'final_action',
  stated: 'stated',
  unknown: 'stated',
};

const STATUS_LABEL: Record<BackstoryEventStatus, string> = {
  proposed: 'Proposed',
  requested: 'Requested',
  recommended: 'Recommended',
  approved: 'Approved',
  denied: 'Denied',
  deferred: 'Deferred',
  withdrawn: 'Withdrawn',
  adopted: 'Adopted',
  constructed: 'Constructed',
  stated: 'Stated in the record',
  unknown: 'Action not stated',
};

const EVENT_TYPE_LABEL: Partial<Record<BackstoryEventType, string>> = {
  rezoning: 'Rezoning',
  subdivision_application: 'Subdivision application',
  development_proposal: 'Development proposal',
  site_plan: 'Site plan',
  master_development_plan: 'Master development plan',
  plat_approval: 'Plat',
  variance_or_exception: 'Variance or exception',
  annexation: 'Annexation',
  development_agreement: 'Development agreement',
  permit: 'Permit',
  engineering_or_study: 'Engineering or study',
  infrastructure_or_utility: 'Infrastructure or utility',
  access_or_road: 'Access or road',
  environmental_constraint: 'Environmental constraint',
  parcel_change: 'Parcel change',
  governing_body_matter: 'Governing-body matter',
};

/**
 * A person or entity a government record named, with the role it named them in.
 *
 * `crmContact` is false for every one of these: they are contextual discoveries
 * about the property's record, not the operator's contact list. Nothing here is
 * written to the CRM, and `overwritesCrmSeller` is a permanent false so no
 * later reader can treat a discovered applicant as the seller.
 */
export type HistoryRelatedParty = {
  name: string;
  role:
    | 'owner_of_record_at_the_time'
    | 'applicant_or_developer'
    | 'applicant_or_representative'
    | 'project';
  roleLabel: string;
  basis: string;
  sourceUrl: string | null;
  crmContact: false;
  overwritesCrmSeller: false;
};

const RELATED_ROLE_LABEL: Record<HistoryRelatedParty['role'], string> = {
  owner_of_record_at_the_time: 'Owner of record at the time',
  applicant_or_developer: 'Applicant / developer',
  applicant_or_representative: 'Applicant or representative named in the record',
  project: 'Named project or subdivision',
};

export type HistoryEventFact = {
  key: string;
  eventDate: string | null;
  dateBasis: string;
  eventType: BackstoryEventType;
  eventTypeLabel: string;
  governingBody: string | null;
  projectName: string | null;
  status: BackstoryEventStatus;
  statusLabel: string;
  statusClass: HistoryStatusClass;
  /**
   * Always false, and structurally so.
   *
   * This lane reads meeting records: agendas, packets and minutes. A recorded
   * action at one body on one date is not a final entitlement — an ordinance
   * "passed on first reading" still has a second, a recommendation still has a
   * decision behind it, and an approved rezoning entitles no lots. LandOS
   * reports what the record says happened and states plainly that it has not
   * established entitlement; the operator gets the recorded action, never a
   * derived approval.
   */
  entitlementEstablished: false;
  /** Why entitlement is reported as it is, in the operator's terms. */
  entitlementBasis: string;
  /**
   * The lot count the record states, always as PROPOSED.
   *
   * There is no entitled-lot field: a lot count scraped from the same passage
   * as an approval is not the count that was entitled, and publishing one
   * would be the exact overstatement this lane exists to avoid.
   */
  proposedLots: number | null;
  proposedUnits: number | null;
  acres: number | null;
  statedAs: string[];
  summary: string;
  apn: string | null;
  parcelNotation: string | null;
  ownerAtTheTime: string | null;
  applicant: string | null;
  sourceUrl: string | null;
  sourceTitles: string[];
  confidence: string;
  limitations: string[];
};

export type HistorySourceFact = {
  title: string;
  sourceType: string;
  url: string | null;
  date: string | null;
  page: number | null;
  retrievedAt: string | null;
  /** True when this document was answered from storage, with no byte fetched. */
  reusedFromStorage: boolean;
};

export type PropertyDevelopmentHistoryFacts = JsonObject & {
  lane: PropertyDevelopmentHistoryLane;
  executed: boolean;
  outcome: PropertyDevelopmentHistoryOutcome;
  subject: {
    propertyCardId: number | null;
    dealCardId: number | null;
    address: string | null;
    apn: string | null;
    county: string | null;
    state: string | null;
  };
  history: {
    established: boolean;
    statement: string;
    eventCount: number;
    events: HistoryEventFact[];
    /** Historical or requested districts. NEVER the district in force today. */
    zoningReferences: Array<{ kind: string; value: string | null; asOf: string | null; sourceUrl: string | null; neverEstablishesCurrentZoning: true }>;
    narrative: string;
    highlights: string[];
    openQuestions: string[];
  };
  relatedParties: HistoryRelatedParty[];
  /** The operator's own contacts, read-only, so roles can be told apart. */
  crmContacts: Array<{ name: string; role: string }>;
  retainedContext: {
    /** Always true: retained context is consumed BEFORE any search runs. */
    consumedBeforeSearch: true;
    documentsHeld: number;
    findingsHeld: number;
    summariesHeld: number;
    documentsReused: number;
  };
  search: {
    ran: boolean;
    bounded: true;
    documentsRetrieved: number;
    sourcesConsulted: number;
    note: string;
  };
  sources: HistorySourceFact[];
  limitations: string[];
  summary: string;
};

/** What the injected bounded history lane returns. It IS the accepted lane. */
export interface PropertyDevelopmentHistoryRuntime {
  /**
   * Raw operator input is resolved by the Property Resolution Capability, never
   * here. The registry injects the real invoker; tests inject a stub.
   */
  resolveSubject?: (request: CapabilityInvocationRequest) => Promise<CapabilityResult>;
  /**
   * The existing bounded Property Backstory lane, owned by the route layer
   * because it reaches the keyless search transport and government hosts.
   */
  runHistorySearch?: (input: { propertyCardId: number; dealCardId: number }) => Promise<PropertyBackstory>;
  /** Retained reads. Injectable so a unit test needs no database. */
  readBackstory?: (dealCardId: number) => PropertyBackstory | null;
  readIntelligence?: (dealCardId: number) => DocumentIntelligenceReadModel;
  readCrmContacts?: (dealCardId: number) => Array<{ name: string; role: string }>;
}

/** The canonical subject this capability was handed, never one it chose. */
interface HistorySubject {
  propertyCardId: number | null;
  dealCardId: number | null;
  address: string | null;
  apn: string | null;
  county: string | null;
  state: string | null;
}

const str = (value: unknown): string | null => {
  const raw = typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';
  return raw && !/^(?:-|--|n\/?a|none|unknown)$/i.test(raw) ? raw : null;
};

const laneOf = (parameters: JsonObject | undefined): PropertyDevelopmentHistoryLane =>
  (typeof parameters?.lane === 'string' ? parameters.lane : '') === 'research' ? 'research' : 'retained_history';

/**
 * One backstory event, projected with its distinctions intact.
 *
 * Every lot count is PROPOSED. The status the record printed travels with it,
 * and entitlement is reported as not established regardless of that status —
 * the record's own wording is the evidence, and a passage that says a matter
 * was approved does not say the development is entitled.
 */
function eventFact(event: PropertyBackstoryEvent): HistoryEventFact {
  const statusClass = STATUS_CLASS[event.status] ?? 'stated';
  const where = event.governingBody ? ` at the ${event.governingBody}` : '';
  const when = event.eventDate ? ` on ${event.eventDate}` : '';
  const entitlementBasis = statusClass === 'final_action'
    ? `The record states this matter was ${(STATUS_LABEL[event.status] ?? event.status).toLowerCase()}${where}${when}. A recorded action at one body on one date is not a final entitlement, so LandOS reports the action and does not establish entitlement from it.`
    : statusClass === 'recommendation'
      ? `The record states a recommendation${where}${when}. A recommendation is not a decision, and no entitlement is established by it.`
      : statusClass === 'request_or_proposal'
        ? `The record states what was asked for${where}${when}, not what was granted. No entitlement is established by a request or a proposal.`
        : 'The record describes this matter without recording an outcome, so no entitlement is established.';
  return {
    key: event.key,
    eventDate: event.eventDate,
    dateBasis: event.dateBasis,
    eventType: event.eventType,
    eventTypeLabel: EVENT_TYPE_LABEL[event.eventType] ?? event.eventType.replace(/_/g, ' '),
    governingBody: event.governingBody,
    projectName: event.subjectOrProject,
    status: event.status,
    statusLabel: STATUS_LABEL[event.status] ?? event.status,
    statusClass,
    entitlementEstablished: false,
    entitlementBasis,
    proposedLots: event.materialNumbers.lots,
    proposedUnits: event.materialNumbers.units,
    acres: event.materialNumbers.acres,
    statedAs: event.materialNumbers.statedAs,
    summary: event.summary,
    apn: event.apn,
    parcelNotation: event.parcelNotation,
    ownerAtTheTime: event.owner,
    applicant: event.applicant,
    sourceUrl: event.sourceUrl,
    sourceTitles: [...new Set(event.evidence.map((row) => row.sourceTitle).filter((row): row is string => Boolean(row)))],
    confidence: event.confidence,
    limitations: event.limitations,
  };
}

/**
 * Every person, entity and project the record named, each in ITS OWN role.
 *
 * The CRM is not consulted to build this and is not written by it. An owner in
 * a 2016 packet is an owner of record AT THE TIME, an applicant is an
 * applicant, and neither becomes "the person Tyler is talking to".
 */
function relatedParties(
  backstory: PropertyBackstory | null,
  intelligence: DocumentIntelligenceReadModel | null,
): HistoryRelatedParty[] {
  const parties: HistoryRelatedParty[] = [];
  const held = new Set<string>();
  const push = (
    name: string | null,
    role: HistoryRelatedParty['role'],
    basis: string,
    sourceUrl: string | null,
  ): void => {
    const value = str(name);
    if (!value) return;
    const key = `${role}:${value.toLowerCase()}`;
    // The stronger applicant role wins. A backstory event that named someone as
    // the applicant and a retained passage that named the same person as an
    // applicant or representative are ONE party, not two rows on the card.
    if (role === 'applicant_or_representative' && held.has(`applicant_or_developer:${value.toLowerCase()}`)) return;
    if (held.has(key)) return;
    held.add(key);
    parties.push({
      name: value,
      role,
      roleLabel: RELATED_ROLE_LABEL[role],
      basis,
      sourceUrl,
      crmContact: false,
      overwritesCrmSeller: false,
    });
  };

  for (const event of backstory?.events ?? []) {
    const when = event.eventDate ? ` dated ${event.eventDate}` : '';
    push(event.applicant, 'applicant_or_developer',
      `Named as the applicant on a ${EVENT_TYPE_LABEL[event.eventType] ?? event.eventType} record${when}.`, event.sourceUrl);
    push(event.owner, 'owner_of_record_at_the_time',
      `Named as the owner on a ${EVENT_TYPE_LABEL[event.eventType] ?? event.eventType} record${when}.`, event.sourceUrl);
    push(event.subjectOrProject, 'project',
      `Named as the project or subdivision on a ${EVENT_TYPE_LABEL[event.eventType] ?? event.eventType} record${when}.`, event.sourceUrl);
  }

  // Opportunistic discoveries the resolver and the land-use lanes retained
  // while doing work they already needed to do.
  for (const finding of intelligence?.findings ?? []) {
    if (finding.category === 'applicant_or_representative') {
      push(finding.value, 'applicant_or_representative',
        `Named in ${finding.sourceTitle || 'an official document'} retained for this parcel.`, finding.sourceUrl);
    }
    if (finding.category === 'project_name') {
      push(finding.value, 'project',
        `Named as the project in ${finding.sourceTitle || 'an official document'} retained for this parcel.`, finding.sourceUrl);
    }
  }
  return parties;
}

/** The operator's own contacts, read-only, purely so roles can be told apart. */
function crmContactsFor(dealCardId: number): Array<{ name: string; role: string }> {
  try {
    const deal = getDealCard(dealCardId);
    return (deal?.people ?? []).map((person) => {
      const row = person as Record<string, unknown>;
      return { name: String(row.name ?? '').trim(), role: String(row.role ?? 'unknown_relation') };
    }).filter((row) => row.name);
  } catch {
    return [];
  }
}

function sourceFacts(backstory: PropertyBackstory | null, intelligence: DocumentIntelligenceReadModel | null): HistorySourceFact[] {
  const sources: HistorySourceFact[] = [];
  const held = new Set<string>();
  const push = (source: HistorySourceFact): void => {
    const key = source.url ?? source.title;
    if (!key || held.has(key)) return;
    held.add(key);
    sources.push(source);
  };
  for (const document of backstory?.documentsReused ?? []) {
    push({
      title: document.sourceTitle ?? document.sourceUrl,
      sourceType: 'official_government_document',
      url: document.sourceUrl,
      date: null,
      page: null,
      retrievedAt: null,
      reusedFromStorage: true,
    });
  }
  for (const document of backstory?.documentsRetrieved ?? []) {
    push({
      title: document.sourceTitle ?? document.sourceUrl,
      sourceType: 'official_government_document',
      url: document.sourceUrl,
      date: null,
      page: null,
      retrievedAt: null,
      reusedFromStorage: false,
    });
  }
  for (const summary of intelligence?.summaries ?? []) {
    push({
      title: summary.sourceTitle ?? summary.documentType ?? summary.sourceUrl,
      sourceType: summary.documentType ?? 'official_government_document',
      url: summary.sourceUrl,
      date: summary.documentDate,
      page: summary.pagesReferenced[0] ?? null,
      retrievedAt: summary.retrievedAt,
      reusedFromStorage: true,
    });
  }
  for (const document of intelligence?.documents ?? []) {
    push({
      title: document.sourceTitle ?? document.sourceUrl,
      sourceType: 'official_government_document',
      url: document.sourceUrl,
      date: null,
      page: null,
      retrievedAt: document.retrievedAt,
      reusedFromStorage: true,
    });
  }
  return sources;
}

function emptyFacts(
  lane: PropertyDevelopmentHistoryLane,
  subject: HistorySubject,
  summary: string,
): PropertyDevelopmentHistoryFacts {
  return {
    lane,
    executed: false,
    outcome: 'not_available',
    subject: {
      propertyCardId: subject.propertyCardId,
      dealCardId: subject.dealCardId,
      address: subject.address,
      apn: subject.apn,
      county: subject.county,
      state: subject.state,
    },
    history: {
      established: false,
      statement: summary,
      eventCount: 0,
      events: [],
      zoningReferences: [],
      narrative: '',
      highlights: [],
      openQuestions: [],
    },
    relatedParties: [],
    crmContacts: [],
    retainedContext: { consumedBeforeSearch: true, documentsHeld: 0, findingsHeld: 0, summariesHeld: 0, documentsReused: 0 },
    search: { ran: false, bounded: true, documentsRetrieved: 0, sourcesConsulted: 0, note: 'No additional search ran.' },
    sources: [],
    limitations: [],
    summary,
  };
}

/** Property Resolution owns raw input. This capability only consumes it. */
async function resolveRawSubject(
  request: CapabilityInvocationRequest,
  runtime: PropertyDevelopmentHistoryRuntime,
): Promise<CapabilityResult> {
  if (runtime.resolveSubject) return runtime.resolveSubject(request);
  const { invokeRuntimeCapability } = await import('./capability-registry.js');
  return invokeRuntimeCapability({
    capabilityId: PROPERTY_RESOLUTION_CAPABILITY_ID,
    caller: request.caller,
    subject: request.subject,
    mode: request.mode ?? 'reuse',
    context: request.context ?? {},
  });
}

function subjectFromCanonicalIdentity(
  identity: Record<string, unknown>,
  canonical: CanonicalSubjectReference | null,
): HistorySubject {
  return {
    propertyCardId: canonical?.propertyCardId ?? null,
    dealCardId: canonical?.dealCardId ?? null,
    address: str(identity.address),
    apn: str(identity.apn),
    county: str(identity.county),
    state: str(identity.state),
  };
}

function projectHistory(
  lane: PropertyDevelopmentHistoryLane,
  subject: HistorySubject,
  backstory: PropertyBackstory | null,
  intelligence: DocumentIntelligenceReadModel | null,
  crmContacts: Array<{ name: string; role: string }>,
  searchRan: boolean,
): { facts: PropertyDevelopmentHistoryFacts; evidence: CapabilityEvidenceReference[]; missingInformation: string[] } {
  const events = (backstory?.events ?? []).map(eventFact);
  const established = events.length > 0;
  const sources = sourceFacts(backstory, intelligence);
  const parties = relatedParties(backstory, intelligence);

  const statement = established
    ? `${events.length} material development or entitlement record(s) were established for this parcel from ${sources.length} official source(s).`
    : NO_MATERIAL_HISTORY_STATEMENT;

  const facts: PropertyDevelopmentHistoryFacts = {
    ...emptyFacts(lane, subject, statement),
    executed: true,
    outcome: established
      ? 'history_returned'
      : backstory || intelligence?.documents.length ? 'no_material_history' : 'not_available',
    history: {
      established,
      statement,
      eventCount: events.length,
      events,
      zoningReferences: (backstory?.zoningReferences ?? []).map((row) => ({
        kind: row.kind,
        value: row.value,
        asOf: row.asOf,
        sourceUrl: row.sourceUrl,
        neverEstablishesCurrentZoning: true as const,
      })),
      narrative: backstory?.summary.narrative ?? (established ? '' : NO_MATERIAL_HISTORY_STATEMENT),
      highlights: backstory?.summary.highlights ?? [],
      openQuestions: backstory?.summary.openQuestions ?? [],
    },
    relatedParties: parties,
    crmContacts,
    retainedContext: {
      consumedBeforeSearch: true,
      documentsHeld: intelligence?.documents.length ?? 0,
      findingsHeld: intelligence?.findings.length ?? 0,
      summariesHeld: intelligence?.summaries.length ?? 0,
      documentsReused: backstory?.documentsReused.length ?? 0,
    },
    search: {
      ran: searchRan,
      bounded: true,
      documentsRetrieved: backstory?.documentsRetrieved.length ?? 0,
      sourcesConsulted: backstory?.sourcesConsulted.length ?? 0,
      note: searchRan
        ? `A bounded targeted search ran after the retained context was consumed; ${backstory?.documentsRetrieved.length ?? 0} document(s) had to be retrieved.`
        : 'No additional search ran: this result was answered from the context LandOS already retained for this parcel.',
    },
    sources,
    limitations: [...new Set([...(backstory?.limitations ?? []), ...(backstory?.summary.limitations ?? [])])],
    summary: statement,
  };

  const evidence: CapabilityEvidenceReference[] = sources
    .filter((source) => source.url)
    .map((source) => ({
      source: source.title,
      sourceUrl: source.url,
      sourceType: source.sourceType,
      retrievedAt: source.retrievedAt ?? backstory?.generatedAt ?? new Date().toISOString(),
      details: { reusedFromStorage: source.reusedFromStorage, date: source.date, page: source.page },
    }));

  // "Nothing established" is a real answer, not a missing input. What IS
  // missing is only ever named where the record itself raised a question.
  const missingInformation = established
    ? [...(backstory?.summary.openQuestions ?? [])]
    : [`${NO_MATERIAL_HISTORY_STATEMENT} That does not mean no history exists.`];

  return { facts, evidence, missingInformation };
}

export const PROPERTY_DEVELOPMENT_HISTORY_CAPABILITY: LandosCapability<
  PropertyDevelopmentHistoryFacts,
  PropertyDevelopmentHistoryRuntime
> = {
  metadata: {
    id: PROPERTY_DEVELOPMENT_HISTORY_CAPABILITY_ID,
    name: 'Property Development History',
    contractVersion: '1.0',
    description: 'Answers what material government, planning and development history has surfaced for the canonical property itself: prior proposals, subdivision and rezoning activity, governing-body action, applicants and projects, with request, recommendation and approval kept distinct — consuming the context LandOS already retained before any bounded additional search, and answering honestly when nothing was established.',
  },
  validate(request: CapabilityInvocationRequest): void {
    const allowed = new Set(['lane', 'runId']);
    const unsupported = Object.keys(request.parameters ?? {}).filter((key) => !allowed.has(key));
    if (unsupported.length) {
      throw new Error(`Property Development History does not accept caller-supplied ${unsupported.join(', ')}; history comes from the official record, not the caller`);
    }
    const lane = request.parameters?.lane;
    if (lane != null && !['retained_history', 'research'].includes(String(lane))) {
      throw new Error(`unknown Property Development History lane ${String(lane)}`);
    }
    const reserved = /^(?:history|events?|approval|approved|entitlement|entitled|rezoning|lots?|applicant|developer|seller|owner|facts|evidence)$/i;
    const asserts = (value: unknown): boolean => {
      if (Array.isArray(value)) return value.some(asserts);
      if (!value || typeof value !== 'object') return false;
      return Object.entries(value as Record<string, unknown>)
        .some(([key, child]) => reserved.test(key) || asserts(child));
    };
    if (asserts(request.context ?? {})) {
      throw new Error('Property Development History context cannot contain caller-supplied history, entitlement or party assertions');
    }
  },
  async execute(
    request: CapabilityInvocationRequest,
    runtime: PropertyDevelopmentHistoryRuntime,
    _environment: CapabilityExecutionEnvironment,
  ): Promise<CapabilityExecutionOutcome<PropertyDevelopmentHistoryFacts>> {
    const lane = laneOf(request.parameters);
    const warnings: string[] = [];
    let subject: HistorySubject;
    let canonicalSubject: CanonicalSubjectReference | null;
    let subjectResolution: SubjectResolutionState;
    let resolutionEvidence: CapabilityEvidenceReference[] = [];

    if (request.subject.kind === 'canonical_property') {
      const propertyCardId = request.subject.propertyCardId;
      const dealCardId = request.subject.dealCardId ?? getDealCardIdForPropertyCard(propertyCardId);
      if (!dealCardId) throw new Error(`canonical property ${propertyCardId} is not linked to a Deal Card`);
      const retainedSubject = readResolverSubject(dealCardId);
      if (!retainedSubject
        || retainedSubject.propertyCardId !== propertyCardId
        || retainedSubject.entity !== request.subject.entity) {
        throw new Error(`canonical property ${propertyCardId} is not the subject of Deal Card ${dealCardId}`);
      }
      subject = {
        propertyCardId,
        dealCardId,
        address: retainedSubject.address,
        apn: retainedSubject.apn,
        county: retainedSubject.county,
        state: retainedSubject.state,
      };
      canonicalSubject = { kind: 'property', id: String(propertyCardId), propertyCardId, dealCardId, temporary: false };
      const evaluation = evaluateResolverIdentity(retainedSubject);
      subjectResolution = evaluation.sufficient ? 'RESOLVED' : 'UNRESOLVED';
      if (!evaluation.sufficient) warnings.push(...evaluation.conflicts);
    } else {
      const resolution = await resolveRawSubject(request, runtime);
      subjectResolution = resolution.subjectResolution;
      canonicalSubject = resolution.canonicalSubject;
      resolutionEvidence = resolution.evidence;
      const identity = (resolution.facts.canonicalIdentity ?? {}) as Record<string, unknown>;
      subject = subjectFromCanonicalIdentity(identity, canonicalSubject);
      warnings.push(...resolution.warnings);
      if (subjectResolution !== 'RESOLVED') {
        return {
          status: 'NEEDS_INPUT',
          subjectResolution,
          canonicalSubject,
          facts: emptyFacts(lane, subject,
            'No property history ran: Property Resolution has not established one canonical parcel for this input.'),
          evidence: resolutionEvidence,
          warnings,
          missingInformation: resolution.missingInformation.length
            ? resolution.missingInformation
            : ['One canonical parcel from Property Resolution'],
        };
      }
      if (subject.dealCardId == null && subject.propertyCardId != null) {
        subject.dealCardId = getDealCardIdForPropertyCard(subject.propertyCardId) ?? null;
      }
    }

    if (subject.dealCardId == null) {
      warnings.push('This subject has no canonical Deal Card, so LandOS retains no document context for it yet. Nothing was created.');
      return {
        status: 'NEEDS_INPUT',
        subjectResolution,
        canonicalSubject,
        facts: emptyFacts(lane, subject,
          'No property history is retained for this subject: it is not a canonical LandOS property yet, and a research run creates no lead.'),
        evidence: resolutionEvidence,
        warnings,
        missingInformation: ['Retained official-document context for this subject, which a canonical Deal Card carries'],
      };
    }

    const dealCardId = subject.dealCardId;

    // ── 1. Everything LandOS already discovered, consumed FIRST ──────────────
    let intelligence: DocumentIntelligenceReadModel | null = null;
    try {
      intelligence = (runtime.readIntelligence ?? readDocumentIntelligence)(dealCardId);
    } catch (error) {
      warnings.push(`Retained document intelligence could not be read (${error instanceof Error ? error.message : String(error)}).`);
    }
    let backstory = (runtime.readBackstory ?? readPropertyBackstory)(dealCardId);

    // ── 2. Only then, a bounded targeted search ──────────────────────────────
    //
    // The bound is the accepted lane's own budget. This capability never widens
    // it and never keeps broadening queries because nothing was found: absence
    // of a result is a valid result.
    let searchRan = false;
    if (lane === 'research') {
      if (!runtime.runHistorySearch || subject.propertyCardId == null) {
        warnings.push('The bounded property-history search lane is not available in this environment.');
      } else {
        backstory = await runtime.runHistorySearch({
          propertyCardId: subject.propertyCardId,
          dealCardId,
        });
        searchRan = true;
        // The lane mines and retains whatever it newly retrieved, so re-reading
        // storage keeps the retained-context counters honest.
        try {
          intelligence = (runtime.readIntelligence ?? readDocumentIntelligence)(dealCardId);
        } catch { /* the projection below tolerates a missing read */ }
      }
    }

    const crmContacts = (runtime.readCrmContacts ?? crmContactsFor)(dealCardId);
    const projected = projectHistory(lane, subject, backstory, intelligence, crmContacts, searchRan);
    const facts: PropertyDevelopmentHistoryFacts = searchRan && projected.facts.outcome === 'not_available'
      ? { ...projected.facts, outcome: 'lane_completed' }
      : projected.facts;

    return {
      // "No material history established" is an honest, complete answer, and it
      // is reported as NEEDS_INPUT rather than SUCCEEDED so no caller reads it
      // as history that was found.
      status: facts.outcome === 'history_returned' ? 'SUCCEEDED' : 'NEEDS_INPUT',
      subjectResolution,
      canonicalSubject,
      facts,
      evidence: [...resolutionEvidence, ...projected.evidence],
      warnings,
      missingInformation: projected.missingInformation,
    };
  },
};
