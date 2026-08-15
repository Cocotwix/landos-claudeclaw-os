// LandOS — PROPERTY BACKSTORY: the story a confirmed parcel already tells.
//
// This runs entirely AFTER Universal Property Resolution has confirmed ONE
// subject. It never rediscovers the parcel, and it never moves canonical
// identity. It answers a different question:
//
//     "What has this property already been through, on the public record?"
//
// The first source is what LandOS ALREADY PAID FOR. `readDocumentIntelligence`
// returns every finding mined from every official document the resolver
// downloaded, plus the detailed summaries composed from them. A backstory that
// re-searched for a document already on disk would be spending the operator's
// time to learn what the database can answer with a SELECT.
//
// Three separations are structural here, not editorial:
//
//   1. HISTORICAL NEVER BECOMES CURRENT. A 2024 planning packet that prints
//      "Current Zoning: R-20" is evidence of what the packet said in 2024. It
//      is retained as a `zoningReference` with its own as-of date and it is
//      REFUSED as an establishment of today's zoning. `neverEstablishesCurrentZoning`
//      is on the type so no reader can take it for one by accident.
//   2. PROPOSED, REQUESTED, RECOMMENDED, APPROVED, DENIED, DEFERRED, WITHDRAWN
//      and CONSTRUCTED are distinct statuses and stay distinct. Collapsing them
//      would turn a denied 119-lot concept into an approved subdivision.
//   3. SUBJECT ONLY. Every event traces to a finding that was anchored to this
//      parcel when it was mined (`official-document-context.ts` skips passages
//      about another map/parcel). Nothing that failed that anchor is here.
//
// Pure. No network, no database, no clock of its own.

import type { PersistedDocumentFinding } from './official-document-intelligence-store.js';
import type { OfficialDocumentSummary } from './official-document-summary.js';

// ── Vocabulary ──────────────────────────────────────────────────────────────

export const BACKSTORY_EVENT_TYPES = [
  'rezoning',
  'subdivision_application',
  'development_proposal',
  'site_plan',
  'master_development_plan',
  'plat_approval',
  'variance_or_exception',
  'annexation',
  'development_agreement',
  'permit',
  'engineering_or_study',
  'infrastructure_or_utility',
  'access_or_road',
  'environmental_constraint',
  'parcel_change',
  'governing_body_matter',
] as const;
export type BackstoryEventType = (typeof BACKSTORY_EVENT_TYPES)[number];

/**
 * What the record says HAPPENED, kept separate from what was ASKED FOR.
 *
 * `stated` is the honest default for a passage that describes a matter without
 * recording an outcome. It is never upgraded to `approved`.
 */
export const BACKSTORY_EVENT_STATUSES = [
  'proposed',
  'requested',
  'recommended',
  'approved',
  'denied',
  'deferred',
  'withdrawn',
  'adopted',
  'constructed',
  'stated',
  'unknown',
] as const;
export type BackstoryEventStatus = (typeof BACKSTORY_EVENT_STATUSES)[number];

export type BackstoryConfidence = 'confirmed' | 'well_supported' | 'likely' | 'unresolved';

export interface BackstoryEvidenceRef {
  /** Durable evidence row id, when this came from persisted intelligence. */
  evidenceId: number | null;
  sourceUrl: string | null;
  sourceTitle: string | null;
  /** 1-based and approximate: content-stream order, never a parsed page tree. */
  page: number | null;
  pageBasis: string;
  /** The document's own words. Never paraphrased into the quote field. */
  quote: string;
  sourceClassification: string;
  retrievedAt: string;
}

export interface BackstoryMaterialNumbers {
  acres: number | null;
  lots: number | null;
  units: number | null;
  /** The wording each number was read from, so a lot count is auditable. */
  statedAs: string[];
}

export interface PropertyBackstoryEvent {
  /** Stable within one backstory: document + page + event type. */
  key: string;
  /** As the document prints it, e.g. "August 13, 2024". Null when unstated. */
  eventDate: string | null;
  dateBasis: 'document_stated_date' | 'not_stated';
  eventType: BackstoryEventType;
  /** The body that acted, when the record names one. */
  governingBody: string | null;
  subjectOrProject: string | null;
  status: BackstoryEventStatus;
  /** Factual, composed only from the quoted evidence below. */
  summary: string;
  apn: string | null;
  parcelNotation: string | null;
  owner: string | null;
  applicant: string | null;
  materialNumbers: BackstoryMaterialNumbers;
  sourceUrl: string | null;
  evidence: BackstoryEvidenceRef[];
  retrievedAt: string;
  confidence: BackstoryConfidence;
  limitations: string[];
}

/**
 * A zoning statement found in the HISTORICAL record.
 *
 * Deliberately not a zoning determination. It carries the date of the document
 * that said it and a flag that no reader can miss.
 */
export interface BackstoryZoningReference {
  kind: 'stated_as_current_at_the_time' | 'requested' | 'rezoning_mentioned';
  value: string | null;
  /** The date the SOURCE carries, not today. */
  asOf: string | null;
  sourceUrl: string | null;
  page: number | null;
  quote: string;
  /** Always true. A historical statement never establishes present zoning. */
  neverEstablishesCurrentZoning: true;
}

export interface PropertyBackstorySubject {
  dealCardId: number;
  apn: string | null;
  parcelNotation: string | null;
  owner: string | null;
  address: string | null;
  city: string | null;
  county: string | null;
  state: string | null;
  acres: number | null;
  projectName: string | null;
}

export interface PropertyBackstorySummary {
  /** The story, in plain sentences, composed only from retained events. */
  narrative: string;
  /** One line per meaningful chapter, newest first. */
  highlights: string[];
  /** Things the record raises and does not answer. */
  openQuestions: string[];
  limitations: string[];
}

export interface PropertyBackstory {
  dealCardId: number;
  subject: PropertyBackstorySubject;
  events: PropertyBackstoryEvent[];
  zoningReferences: BackstoryZoningReference[];
  summary: PropertyBackstorySummary;
  /** Documents answered from storage. No byte was fetched for these. */
  documentsReused: Array<{ documentKey: string; sourceUrl: string; sourceTitle: string | null; findingCount: number }>;
  /** Documents this run had to retrieve because storage did not hold them. */
  documentsRetrieved: Array<{ sourceUrl: string; sourceTitle: string | null; reason: string }>;
  /** Everything consulted, retrieved or not. */
  sourcesConsulted: Array<{ url: string; title: string | null; used: boolean; note: string }>;
  limitations: string[];
  generatedAt: string;
}

// ── Reading events out of retained document intelligence ────────────────────

const EVENT_TYPE_BY_CATEGORY: Partial<Record<string, BackstoryEventType>> = {
  rezoning: 'rezoning',
  requested_zoning: 'rezoning',
  subdivision_or_development_proposal: 'subdivision_application',
  lot_count_or_density: 'development_proposal',
  project_name: 'development_proposal',
  governing_body_action: 'governing_body_matter',
  engineering_or_study: 'engineering_or_study',
  infrastructure: 'infrastructure_or_utility',
  utilities_sewer_water: 'infrastructure_or_utility',
  road_improvement: 'access_or_road',
  access: 'access_or_road',
  topography_or_grading: 'environmental_constraint',
  wetlands_floodplain_stream: 'environmental_constraint',
  open_space: 'environmental_constraint',
  acreage_or_parcel_change: 'parcel_change',
};

/** Wording that names a more specific proposal than "development proposal". */
const PROPOSAL_REFINEMENTS: Array<{ pattern: RegExp; type: BackstoryEventType }> = [
  { pattern: /\bmaster\s+development\s+plan\b/i, type: 'master_development_plan' },
  { pattern: /\b(?:preliminary|final)\s+plat\b/i, type: 'plat_approval' },
  { pattern: /\bsite\s+plan\b/i, type: 'site_plan' },
  { pattern: /\bsubdivision\s+(?:plat|application|plan)\b/i, type: 'subdivision_application' },
  { pattern: /\bplanned\s+(?:unit\s+)?development\b/i, type: 'development_proposal' },
  { pattern: /\bvariance\b|\bspecial\s+exception\b|\bconditional\s+use\b/i, type: 'variance_or_exception' },
  { pattern: /\bannex(?:ation|ed|ing)\b/i, type: 'annexation' },
  { pattern: /\bdevelopment\s+agreement\b/i, type: 'development_agreement' },
  { pattern: /\bbuilding\s+permit\b|\bgrading\s+permit\b/i, type: 'permit' },
];

/**
 * The outcome a passage records, or `stated` when it records none.
 *
 * The order matters: a sentence that says a request was DENIED is a denial even
 * though it also contains the word "request". Terminal outcomes are read first.
 */
const STATUS_RULES: Array<{ pattern: RegExp; status: BackstoryEventStatus }> = [
  { pattern: /\bwithdrew\b|\bwithdrawn\b/i, status: 'withdrawn' },
  { pattern: /\bdenied\b|\bdisapproved\b|\bfailed\s+to\s+pass\b|\brejected\b/i, status: 'denied' },
  { pattern: /\bdeferred\b|\btabled\b|\bcontinued\s+to\b/i, status: 'deferred' },
  { pattern: /\badopted\b|\bpassed\s+(?:on\s+)?(?:first|second|final)\s+reading\b/i, status: 'adopted' },
  { pattern: /\bapproved\b|\bapproval\s+(?:was\s+)?granted\b/i, status: 'approved' },
  { pattern: /\brecommend(?:ed|ation|s)\b/i, status: 'recommended' },
  { pattern: /\bconstructed\b|\bbuilt\b|\bcompleted\s+construction\b/i, status: 'constructed' },
  { pattern: /\brequest(?:ed|ing|s)?\b|\bapplic(?:ation|ant)\b/i, status: 'requested' },
  { pattern: /\bpropos(?:ed|al|es|ing)\b|\bconcept\b/i, status: 'proposed' },
];

const GOVERNING_BODY_RULES: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /\bplanning\s+commission\b/i, name: 'Planning Commission' },
  { pattern: /\bboard\s+of\s+mayor\s+and\s+(?:aldermen|commissioners)\b/i, name: 'Board of Mayor and Aldermen' },
  { pattern: /\bboard\s+of\s+zoning\s+appeals\b/i, name: 'Board of Zoning Appeals' },
  { pattern: /\bcity\s+(?:council|commission)\b/i, name: 'City Council' },
  { pattern: /\bcounty\s+commission\b/i, name: 'County Commission' },
  { pattern: /\bboard\s+of\s+(?:county\s+)?commissioners\b/i, name: 'Board of Commissioners' },
  { pattern: /\bdesign\s+review\s+(?:board|committee)\b/i, name: 'Design Review Board' },
];

const clean = (value: string): string => value.replace(/\s+/g, ' ').trim();

function readStatus(text: string): BackstoryEventStatus {
  for (const rule of STATUS_RULES) if (rule.pattern.test(text)) return rule.status;
  return 'stated';
}

function readGoverningBody(text: string): string | null {
  for (const rule of GOVERNING_BODY_RULES) if (rule.pattern.test(text)) return rule.name;
  return null;
}

function refineEventType(base: BackstoryEventType, text: string): BackstoryEventType {
  for (const rule of PROPOSAL_REFINEMENTS) if (rule.pattern.test(text)) return rule.type;
  return base;
}

function readLots(text: string): { lots: number | null; statedAs: string | null } {
  const match = /\b(\d{1,4})\s*(?:single[- ]family\s+)?lots?\b/i.exec(text);
  if (!match) return { lots: null, statedAs: null };
  const lots = Number(match[1]);
  return Number.isFinite(lots) && lots > 0 ? { lots, statedAs: clean(match[0]) } : { lots: null, statedAs: null };
}

function readUnits(text: string): { units: number | null; statedAs: string | null } {
  const match = /\b(\d{1,5})\s*(?:dwelling\s+)?units?\b/i.exec(text);
  if (!match) return { units: null, statedAs: null };
  const units = Number(match[1]);
  return Number.isFinite(units) && units > 0 ? { units, statedAs: clean(match[0]) } : { units: null, statedAs: null };
}

function readAcres(text: string): { acres: number | null; statedAs: string | null } {
  const match = /\b(\d{1,5}(?:\.\d{1,3})?)\s*(?:\+\/-\s*)?acres?\b/i.exec(text);
  if (!match) return { acres: null, statedAs: null };
  const acres = Number(match[1]);
  return Number.isFinite(acres) && acres > 0 ? { acres, statedAs: clean(match[0]) } : { acres: null, statedAs: null };
}

/**
 * The confidence an event carries.
 *
 * `confirmed` requires an official document AND a stated outcome verb — the
 * record itself saying what happened. A topic match with no outcome is
 * `likely` at best, and that is the honest weight for "the packet discusses
 * grading on this parcel".
 */
function eventConfidence(status: BackstoryEventStatus, evidence: BackstoryEvidenceRef[]): BackstoryConfidence {
  const official = evidence.some((ref) => ref.sourceClassification === 'official_government_document');
  const decided = ['approved', 'denied', 'deferred', 'withdrawn', 'adopted', 'recommended', 'constructed'].includes(status);
  if (official && decided) return 'confirmed';
  if (official && (status === 'requested' || status === 'proposed')) return 'well_supported';
  if (official) return 'likely';
  return 'likely';
}

export interface BackstoryFromDocumentsInput {
  subject: PropertyBackstorySubject;
  findings: readonly PersistedDocumentFinding[];
  summaries: readonly OfficialDocumentSummary[];
}

/**
 * Turn retained document findings into a subject timeline.
 *
 * Findings are grouped by DOCUMENT and PAGE, because that is what one agenda
 * item actually is. A page that discusses a rezoning, its lot count, and the
 * commission's vote is ONE event with three pieces of evidence, not three
 * events that read like three separate applications.
 */
export function backstoryEventsFromDocuments(
  input: BackstoryFromDocumentsInput,
): { events: PropertyBackstoryEvent[]; zoningReferences: BackstoryZoningReference[] } {
  const summaryByKey = new Map(input.summaries.map((row) => [row.documentKey, row]));
  const summaryByUrl = new Map(input.summaries.map((row) => [row.sourceUrl, row]));

  interface Bucket {
    documentKey: string;
    sourceUrl: string | null;
    sourceTitle: string | null;
    page: number | null;
    findings: PersistedDocumentFinding[];
  }
  const buckets = new Map<string, Bucket>();
  const zoningReferences: BackstoryZoningReference[] = [];

  for (const finding of input.findings) {
    const summary = summaryByKey.get(finding.documentKey)
      ?? (finding.sourceUrl ? summaryByUrl.get(finding.sourceUrl) : undefined);
    const asOf = summary?.documentDate ?? null;

    // Zoning statements are pulled OUT of the timeline and kept as dated
    // references. They describe zoning as of the document, never as of now.
    if (finding.category === 'current_zoning' || finding.category === 'requested_zoning' || finding.category === 'rezoning') {
      zoningReferences.push({
        kind: finding.category === 'current_zoning'
          ? 'stated_as_current_at_the_time'
          : finding.category === 'requested_zoning' ? 'requested' : 'rezoning_mentioned',
        value: finding.value,
        asOf,
        sourceUrl: finding.sourceUrl,
        page: finding.page,
        quote: finding.context,
        neverEstablishesCurrentZoning: true,
      });
      // A rezoning is also a real event; a bare "current zoning" line is not.
      if (finding.category === 'current_zoning') continue;
    }

    const key = `${finding.documentKey || finding.sourceUrl || 'unknown'}|${finding.page ?? 'na'}`;
    const bucket = buckets.get(key) ?? {
      documentKey: finding.documentKey,
      sourceUrl: finding.sourceUrl,
      sourceTitle: finding.sourceTitle,
      page: finding.page,
      findings: [],
    };
    bucket.findings.push(finding);
    buckets.set(key, bucket);
  }

  const events: PropertyBackstoryEvent[] = [];
  for (const bucket of buckets.values()) {
    const summary = summaryByKey.get(bucket.documentKey)
      ?? (bucket.sourceUrl ? summaryByUrl.get(bucket.sourceUrl) : undefined);
    const text = bucket.findings.map((finding) => finding.context).join(' ');
    const categories = new Set(bucket.findings.map((finding) => finding.category));

    // The strongest category present decides the event type; the wording then
    // refines it. "subdivision_or_development_proposal" plus "master
    // development plan" in the sentence is a master development plan.
    let base: BackstoryEventType | null = null;
    for (const category of ['subdivision_or_development_proposal', 'rezoning', 'requested_zoning', 'acreage_or_parcel_change',
      'lot_count_or_density', 'road_improvement', 'utilities_sewer_water', 'infrastructure', 'engineering_or_study',
      'access', 'wetlands_floodplain_stream', 'topography_or_grading', 'open_space', 'project_name', 'governing_body_action']) {
      if (categories.has(category)) { base = EVENT_TYPE_BY_CATEGORY[category] ?? null; break; }
    }
    if (!base) continue;
    const eventType = refineEventType(base, text);

    const evidence: BackstoryEvidenceRef[] = bucket.findings.map((finding) => ({
      evidenceId: finding.evidenceId,
      sourceUrl: finding.sourceUrl,
      sourceTitle: finding.sourceTitle,
      page: finding.page,
      pageBasis: finding.pageBasis,
      quote: finding.context,
      sourceClassification: finding.sourceClassification,
      retrievedAt: finding.retrievedAt,
    }));

    const status = readStatus(text);
    const lots = readLots(text);
    const units = readUnits(text);
    const acres = readAcres(text);
    const project = bucket.findings.find((finding) => finding.category === 'project_name')?.value
      ?? input.subject.projectName
      ?? null;
    const applicant = bucket.findings.find((finding) => finding.category === 'applicant_or_representative')?.value ?? null;

    const numbers: BackstoryMaterialNumbers = {
      acres: acres.acres,
      lots: lots.lots,
      units: units.units,
      statedAs: [acres.statedAs, lots.statedAs, units.statedAs].filter((row): row is string => !!row),
    };

    events.push({
      key: `${bucket.documentKey || 'doc'}:${bucket.page ?? 0}:${eventType}`,
      eventDate: summary?.documentDate ?? null,
      dateBasis: summary?.documentDate ? 'document_stated_date' : 'not_stated',
      eventType,
      governingBody: readGoverningBody(`${text} ${summary?.documentType ?? ''}`),
      subjectOrProject: project,
      status,
      summary: describeEvent({ eventType, status, project, numbers, page: bucket.page, sourceTitle: bucket.sourceTitle, documentType: summary?.documentType ?? null }),
      apn: input.subject.apn,
      parcelNotation: input.subject.parcelNotation,
      owner: input.subject.owner,
      applicant,
      materialNumbers: numbers,
      sourceUrl: bucket.sourceUrl,
      evidence,
      retrievedAt: evidence[0]?.retrievedAt ?? '',
      confidence: eventConfidence(status, evidence),
      limitations: [
        ...(summary?.documentDate ? [] : ['The source document states no date this event can be placed on.']),
        ...(bucket.page == null ? [] : []),
      ],
    });
  }

  events.sort(compareEventsNewestFirst);
  return { events, zoningReferences: dedupeZoningReferences(zoningReferences) };
}

function dedupeZoningReferences(rows: BackstoryZoningReference[]): BackstoryZoningReference[] {
  const seen = new Set<string>();
  const out: BackstoryZoningReference[] = [];
  for (const row of rows) {
    const key = `${row.kind}|${row.value ?? ''}|${row.asOf ?? ''}|${row.sourceUrl ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

/** Newest first; undated events sort last so the timeline still reads. */
export function compareEventsNewestFirst(a: PropertyBackstoryEvent, b: PropertyBackstoryEvent): number {
  const left = eventSortValue(a.eventDate);
  const right = eventSortValue(b.eventDate);
  if (left !== right) return right - left;
  return a.key.localeCompare(b.key);
}

function eventSortValue(date: string | null): number {
  if (!date) return -1;
  const parsed = Date.parse(date);
  return Number.isFinite(parsed) ? parsed : -1;
}

const EVENT_TYPE_PROSE: Record<BackstoryEventType, string> = {
  rezoning: 'a rezoning matter',
  subdivision_application: 'a subdivision application',
  development_proposal: 'a development proposal',
  site_plan: 'a site plan',
  master_development_plan: 'a master development plan',
  plat_approval: 'a plat',
  variance_or_exception: 'a variance or special-exception matter',
  annexation: 'an annexation matter',
  development_agreement: 'a development agreement',
  permit: 'a permit',
  engineering_or_study: 'engineering work or a study',
  infrastructure_or_utility: 'infrastructure, sewer, water or utility service',
  access_or_road: 'access or road improvements',
  environmental_constraint: 'terrain, drainage or environmental constraints',
  parcel_change: 'a change in the parcel or its acreage',
  governing_body_matter: 'a matter before a governing body',
};

const STATUS_PROSE: Record<BackstoryEventStatus, string> = {
  proposed: 'was proposed',
  requested: 'was requested',
  recommended: 'was recommended',
  approved: 'was approved',
  denied: 'was denied',
  deferred: 'was deferred',
  withdrawn: 'was withdrawn',
  adopted: 'was adopted',
  constructed: 'was built',
  stated: 'is discussed',
  unknown: 'is recorded without a stated outcome',
};

function describeEvent(input: {
  eventType: BackstoryEventType;
  status: BackstoryEventStatus;
  project: string | null;
  numbers: BackstoryMaterialNumbers;
  page: number | null;
  sourceTitle: string | null;
  documentType: string | null;
}): string {
  const parts: string[] = [];
  parts.push(`${input.project ? `${input.project}: ` : ''}${EVENT_TYPE_PROSE[input.eventType]} ${STATUS_PROSE[input.status]}`);
  const scale = [
    input.numbers.lots != null ? `${input.numbers.lots} lot(s)` : null,
    input.numbers.units != null ? `${input.numbers.units} unit(s)` : null,
    input.numbers.acres != null ? `${input.numbers.acres} acre(s)` : null,
  ].filter(Boolean);
  if (scale.length) parts.push(`stated at ${scale.join(', ')}`);
  const where = input.documentType ?? input.sourceTitle;
  if (where) parts.push(`per ${where}${input.page != null ? ` (approx. p. ${input.page})` : ''}`);
  else if (input.page != null) parts.push(`(approx. p. ${input.page})`);
  return `${parts.join(', ')}.`;
}

// ── The summary ─────────────────────────────────────────────────────────────

/**
 * The story, composed from the events and nothing else.
 *
 * The rule this enforces is the one the sprint brief names: it must not invent
 * facts, and it must not let a historical statement read as a current one.
 * Every zoning sentence it emits carries the date of the document that said it.
 */
export function composePropertyBackstorySummary(input: {
  subject: PropertyBackstorySubject;
  events: readonly PropertyBackstoryEvent[];
  zoningReferences: readonly BackstoryZoningReference[];
  documentsReused: number;
  documentsRetrieved: number;
}): PropertyBackstorySummary {
  const { events, zoningReferences } = input;
  const limitations: string[] = [];
  const openQuestions: string[] = [];

  if (!events.length) {
    return {
      narrative: 'No public development, planning or governing-body history was retained for this parcel from the official documents LandOS holds. That is an absence of retained record, not evidence that nothing happened.',
      highlights: [],
      openQuestions: ['Has this parcel ever been before the planning commission or governing body? Nothing in the retained official record shows it.'],
      limitations: ['No official document in LandOS storage carried a subject-specific planning or development finding.'],
    };
  }

  const named = [input.subject.owner, input.subject.apn].filter(Boolean).join(', parcel ');
  const dated = events.filter((event) => event.eventDate);
  const span = dated.length
    ? `${dated[dated.length - 1].eventDate} through ${dated[0].eventDate}`
    : null;

  const decided = events.filter((event) => ['approved', 'denied', 'deferred', 'withdrawn', 'adopted'].includes(event.status));
  const asked = events.filter((event) => event.status === 'requested' || event.status === 'proposed');
  const biggestLots = events
    .map((event) => event.materialNumbers.lots)
    .filter((lots): lots is number => lots != null)
    .sort((a, b) => b - a)[0] ?? null;

  const sentences: string[] = [];
  sentences.push(
    `The retained official record carries ${events.length} subject-specific matter(s) for this parcel${named ? ` (${named})` : ''}${span ? `, spanning ${span}` : ', none of which the source documents dated'}.`,
  );
  if (asked.length) {
    const kinds = [...new Set(asked.map((event) => EVENT_TYPE_PROSE[event.eventType]))];
    sentences.push(`What was sought: ${kinds.join('; ')}${biggestLots != null ? `, at up to ${biggestLots} lots as stated in the record` : ''}.`);
  }
  if (decided.length) {
    sentences.push(
      `Recorded outcomes: ${decided.map((event) => `${event.eventDate ?? 'undated'} — ${EVENT_TYPE_PROSE[event.eventType]} ${STATUS_PROSE[event.status]}`).join('; ')}.`,
    );
  } else {
    sentences.push('No governing-body outcome (approval, denial, deferral or withdrawal) is recorded in the retained documents, so nothing here shows how any of it ended.');
    openQuestions.push('How did the prior planning matters end? The retained record states no approval, denial, deferral or withdrawal.');
  }

  const currentish = zoningReferences.filter((row) => row.kind === 'stated_as_current_at_the_time' && row.value);
  const requested = zoningReferences.filter((row) => row.kind === 'requested' && row.value);
  if (currentish.length) {
    sentences.push(
      `Zoning as the historical record stated it: ${currentish.map((row) => `"${row.value}" as of ${row.asOf ?? 'an undated document'}`).join('; ')}. `
      + 'That is what the document said on its own date and it does NOT establish the current zoning district.',
    );
    limitations.push('Zoning values in this backstory are historical statements carrying their own as-of dates. Current zoning must be verified separately against the controlling authority.');
  }
  if (requested.length) {
    sentences.push(`Zoning the record shows was REQUESTED (not necessarily granted): ${requested.map((row) => `"${row.value}"`).join('; ')}.`);
  }

  const constraints = events.filter((event) => event.eventType === 'environmental_constraint' || event.eventType === 'access_or_road' || event.eventType === 'infrastructure_or_utility');
  if (constraints.length) {
    sentences.push(`The record also discusses ${[...new Set(constraints.map((event) => EVENT_TYPE_PROSE[event.eventType]))].join(', ')} on this parcel.`);
  }

  if (asked.length && !decided.length) {
    openQuestions.push('Why did the owner stop pursuing the development that the record shows was sought?');
  }
  if (input.documentsReused > 0) {
    limitations.push(`${input.documentsReused} document(s) were answered from retained LandOS intelligence without re-fetching the source.`);
  }
  const undated = events.filter((event) => !event.eventDate).length;
  if (undated) limitations.push(`${undated} event(s) could not be dated because the source document prints no date.`);

  const highlights = events.slice(0, 10).map((event) =>
    `${event.eventDate ?? 'Undated'} — ${event.summary}`);

  return { narrative: sentences.join(' '), highlights, openQuestions, limitations };
}
