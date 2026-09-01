// LandOS — what the operator's own documents actually say, and what that does
// to the Deal.
//
// THE DEFECT THIS REPAIRS.
//
// Uploading evidence already classified the file, read it with the multimodal
// model, and retained the extraction verbatim on `landos_intake_artifact`. Then
// it stopped. The coverage cycle fired on the *fact* that a file arrived, never
// on its *contents*: six seller pages could establish the survey acreage, the
// grantee, and the recording reference, and the research loop would replan as
// though nothing had been read. The operator saw "(6 attachments)" and silence.
//
// So this module sits between the retained extraction and the coverage cycle.
// It reads artifacts that were ALREADY interpreted — it re-uploads nothing, it
// re-reads no bytes, it makes no model call — and turns retained text into
// discrete claims that each carry the exact page they came from. Then it says
// what each claim does to the Deal's current working conclusion: supports it,
// contradicts it, adds something new, or cannot be resolved from the page.
//
// What this deliberately is NOT:
//   • Not a second research engine. It retrieves nothing. Every input is
//     already-retained evidence on this Deal.
//   • Not a second evidence database. Claims are derived from
//     `landos_intake_artifact` rows on demand and carry their artifact id;
//     the artifact remains the one retained original.
//   • Not identity. `PERMANENT_MEMORY.md` invariants 2-4 stand: a claim is an
//     unconfirmed operator-supplied statement, and no claim here promotes
//     anything to Confirmed. A page naming a different parcel is evidence about
//     THAT parcel — invariant 4 — so it never replaces the subject and is never
//     judged as though it disagreed with the subject.
//   • Not an overwrite. Reconciliation reports; canonical state is written by
//     the engines that own it, on evidence they accept.

/** What a claim is about. Kept to the fields land documents actually state. */
export type EvidenceClaimField =
  | 'apn'
  | 'owner'
  | 'grantor'
  | 'grantee'
  | 'legalDescription'
  | 'recording'
  | 'acreage'
  | 'dimension'
  | 'roadFrontage'
  | 'roadName'
  | 'adjoiningParcel'
  | 'surveyBoundary'
  | 'surveyDate'
  | 'parcelSplit'
  | 'floodZone'
  | 'easement'
  | 'other';

/**
 * What the page is. Determined from the retained text, not from the filename —
 * six files all named `image.png` carry no signal, and the operator should not
 * have to label their own documents for LandOS to know a deed from a survey.
 */
export type EvidenceDocumentKind =
  | 'deed'
  | 'survey'
  | 'recording_receipt'
  | 'unreadable'
  | 'unknown';

/**
 * Where a claim came from, precisely enough to reopen the exact page.
 *
 * Grouping is metadata. `groupLabel` is a convenience for the operator ("Seller
 * Survey — 3 pages"); `artifactId` and `fileName` are the provenance that
 * matters, and every claim carries them individually. A claim is never
 * attributed to a group.
 */
export interface EvidenceClaimProvenance {
  artifactId: number;
  /** The retained Documents & Uploads row holding the original file. */
  uploadId: number | null;
  fileName: string;
  /** Operator-facing page identity, e.g. "Seller Survey — page 2 of 3". */
  pageLabel: string;
  groupLabel: string;
  documentKind: EvidenceDocumentKind;
  /** Always operator-supplied here; the retrieval lanes carry their own. */
  sourceType: 'operator_supplied_document';
  capturedAt: number;
}

/** What this claim does to the Deal's current working conclusion. */
export type EvidenceClaimRelation = 'supports' | 'contradicts' | 'adds' | 'unresolved';

/**
 * Which parcel a claim is actually ABOUT.
 *
 * This is the distinction that stops a whole class of false contradictions. The
 * sellers here own three adjoining parcels and are keeping two; a deed in the
 * packet can legitimately describe a parcel that is not the subject. Without
 * this field every such page reads as the subject disagreeing with itself, and
 * the honest answer — "this concerns a different parcel in the same ownership
 * group" — has nowhere to live.
 *
 * It is deliberately a small enumeration on the claim, not a parcel graph.
 */
export type ClaimParcelRelationship =
  | 'subject'
  | 'related_parcel'
  | 'parent_or_source_parcel'
  | 'historical_parcel'
  | 'mailing_or_contact'
  | 'unresolved_relationship';

export interface EvidenceClaim {
  field: EvidenceClaimField;
  /** Operator-facing label for the field, e.g. "Survey acreage". */
  label: string;
  /** Exactly what the page says, normalized only for whitespace. */
  value: string;
  /** The line the value was read out of, so the operator can check the page. */
  excerpt: string;
  provenance: EvidenceClaimProvenance;
  relation: EvidenceClaimRelation;
  /** Which parcel this claim concerns. Only `subject` claims touch the Deal. */
  parcelRelationship: ClaimParcelRelationship;
  /** Why the relation is what it is, in the operator's language. */
  reason: string;
  /**
   * How much weight this claim carries on its own, per contract section 9.
   * A recorded instrument read off a page is `well_supported`; a value the
   * model flagged uncertain is `likely`. Nothing here reaches `confirmed`:
   * an operator-supplied page is not an official record.
   */
  weight: 'well_supported' | 'likely' | 'unresolved';
}

/** One retained artifact, as this module needs it. No bytes, no re-reading. */
export interface RetainedEvidenceArtifact {
  artifactId: number;
  uploadId: number | null;
  fileName: string;
  extractionStatus: string;
  /** The verbatim text the vision pass already retained. */
  exactText: string;
  /** Normalized field candidates the extraction already produced. */
  candidates: Record<string, string>;
  capturedAt: number;
}

/** The Deal's current working conclusion, as the reconciler compares against. */
export interface DealWorkingState {
  apn: string | null;
  owner: string | null;
  acreage: number | null;
  roadName: string | null;
  county: string | null;
}

export interface EvidenceDocumentGroup {
  kind: EvidenceDocumentKind;
  label: string;
  artifactIds: number[];
  pageCount: number;
  /** Pages retained but not interpreted, named honestly rather than hidden. */
  unreadablePageCount: number;
}

export interface DealEvidenceInterpretation {
  groups: EvidenceDocumentGroup[];
  claims: EvidenceClaim[];
  /** Pages LandOS could not read, kept and reported as such. */
  unreadable: Array<{ artifactId: number; fileName: string; reason: string }>;
  acreage: AcreageProvenanceReconciliation | null;
  /** Boundary geometry with each dimension bound to the segment it describes,
   *  kept distinct from provider-reported frontage. */
  boundary: BoundaryFrontageReconciliation | null;
  /** One-line operator summary per group, for the Smart Intake reply. */
  narrative: string;
  /**
   * Fields the documents genuinely settled, so the coverage cycle can leave
   * those requirements alone instead of re-running research nobody needs.
   */
  satisfiedFields: EvidenceClaimField[];
  /** Contradictions a specialist must resolve before anything downstream. */
  openContradictions: EvidenceClaim[];
  /** Parcel identifiers the packet names that are not the subject, preserved
   *  exactly with their page and their open relationship. */
  relatedParcelReferences: Array<{
    artifactId: number;
    statedApn: string;
    relationship: ClaimParcelRelationship;
    pageLabel: string;
  }>;
}

/**
 * The acreage question, answered from provenance instead of preference.
 *
 * Two acreages on one Deal is not necessarily a defect: a surveyed boundary and
 * a GIS-calculated polygon measure different things and legitimately differ. So
 * this names what each number IS before choosing between them, and when both
 * are legitimate it keeps both, labeled, and states why the working one won.
 */
export interface AcreageProvenanceReconciliation {
  entries: Array<{
    acres: number;
    basis: 'survey' | 'deed' | 'assessor' | 'provider' | 'gis_calculated' | 'unknown';
    label: string;
    source: string;
    artifactId: number | null;
  }>;
  workingAcres: number | null;
  workingBasis: string | null;
  reason: string;
  /** True when the spread is real and both numbers are legitimately different
   *  measurements rather than one being stale or wrong. */
  bothLegitimate: boolean;
}

// ── Document classification ────────────────────────────────────────────────
//
// From the retained text only. Signals are the words these instruments actually
// carry, so a page is typed by what it says rather than by what it is named.

const DEED_SIGNALS = /\b(?:warranty deed|quit ?claim deed|this indenture|grantor|grantee|parties of the first part|doc stamp-deed|exhibit a)\b/i;
const SURVEY_SIGNALS = /\b(?:map of survey|boundary survey|field survey|basis of bearings|point of commencement|point of beginning|surveyor|flood zone data|professional surveyor)\b/i;
const RECEIPT_SIGNALS = /\b(?:official records receipt|receipt\s*#|amount tendered|payment method|receipt total)\b/i;

export function classifyEvidenceDocument(artifact: RetainedEvidenceArtifact): EvidenceDocumentKind {
  if (artifact.extractionStatus === 'unavailable' || !artifact.exactText.trim()) return 'unreadable';
  const text = artifact.exactText;
  // Order matters: a recording receipt quotes deed language, and a survey sheet
  // quotes the deed's legal description verbatim. The most specific container
  // signal wins, so the receipt is not filed as the deed it paid to record and
  // the survey is not filed as the deed it transcribes.
  if (RECEIPT_SIGNALS.test(text)) return 'recording_receipt';
  if (SURVEY_SIGNALS.test(text)) return 'survey';
  if (DEED_SIGNALS.test(text)) return 'deed';
  return 'unknown';
}

const GROUP_LABEL: Record<EvidenceDocumentKind, string> = {
  deed: 'Seller Deed',
  survey: 'Seller Survey',
  recording_receipt: 'Recording Receipt',
  unreadable: 'Retained, not interpreted',
  unknown: 'Seller-supplied document',
};

const GROUP_ORDER: EvidenceDocumentKind[] = ['deed', 'survey', 'recording_receipt', 'unknown', 'unreadable'];

/**
 * Group pages logically without ever losing the page.
 *
 * The grouping is presentation. Every artifact keeps its own id and its own
 * position within the group, so a claim reads back to one exact original page.
 */
export function groupEvidenceDocuments(
  artifacts: RetainedEvidenceArtifact[],
): { groups: EvidenceDocumentGroup[]; kindOf: Map<number, EvidenceDocumentKind>; pageLabelOf: Map<number, string> } {
  const kindOf = new Map<number, EvidenceDocumentKind>();
  const buckets = new Map<EvidenceDocumentKind, RetainedEvidenceArtifact[]>();
  // Oldest first, so page numbering follows the order the operator supplied.
  const ordered = [...artifacts].sort((a, b) => a.capturedAt - b.capturedAt || a.artifactId - b.artifactId);
  for (const artifact of ordered) {
    const kind = classifyEvidenceDocument(artifact);
    kindOf.set(artifact.artifactId, kind);
    const bucket = buckets.get(kind) ?? [];
    bucket.push(artifact);
    buckets.set(kind, bucket);
  }
  const pageLabelOf = new Map<number, string>();
  const groups: EvidenceDocumentGroup[] = [];
  for (const kind of GROUP_ORDER) {
    const bucket = buckets.get(kind);
    if (!bucket?.length) continue;
    const label = `${GROUP_LABEL[kind]} — ${bucket.length} page${bucket.length === 1 ? '' : 's'}`;
    bucket.forEach((artifact, index) => {
      pageLabelOf.set(
        artifact.artifactId,
        `${GROUP_LABEL[kind]} — page ${index + 1} of ${bucket.length}`,
      );
    });
    groups.push({
      kind,
      label,
      artifactIds: bucket.map((a) => a.artifactId),
      pageCount: bucket.length,
      unreadablePageCount: kind === 'unreadable' ? bucket.length : 0,
    });
  }
  return { groups, kindOf, pageLabelOf };
}

// ── Claim extraction ───────────────────────────────────────────────────────
//
// Only what the page actually supports. Every pattern below reads a value out
// of retained text and keeps the line it came from as the excerpt, so nothing
// is asserted that the operator cannot see on their own document.

interface ClaimPattern {
  field: EvidenceClaimField;
  label: string;
  pattern: RegExp;
  /** Which capture group carries the value. Defaults to 1. */
  group?: number;
  /** Restrict to document kinds where the pattern is meaningful. */
  kinds?: EvidenceDocumentKind[];
}

const CLAIM_PATTERNS: ClaimPattern[] = [
  { field: 'apn', label: 'Parcel identifier', pattern: /\b(?:parcel\s*id(?:entification)?\s*(?:#|no\.?|number)?|apn|tax\s*(?:parcel|id))\s*[:#]?\s*([0-9][0-9A-Za-z\-.]{4,})/i },
  { field: 'acreage', label: 'Stated acreage', pattern: /\b([0-9]+(?:\.[0-9]+)?)\s*acres?\b/i },
  { field: 'recording', label: 'Recording reference', pattern: /\bB\s*:\s*([0-9]+\s*P\s*:\s*[0-9]+)/i },
  { field: 'recording', label: 'Instrument number', pattern: /\bInst\s*:?\s*([0-9]{6,})/i },
  { field: 'recording', label: 'Official Records book/page', pattern: /\bO\.?\s*R\.?\s*([0-9]+,?\s*pages?\s*[0-9]+(?:\s*through\s*[0-9]+)?)/i },
  { field: 'surveyDate', label: 'Field survey date', pattern: /field\s*survey["']?\s*[:]?\s*([A-Z][a-z]+\s+[0-9]{1,2},\s*[0-9]{4})/i },
  { field: 'roadName', label: 'Road name', pattern: /\b((?:N\.?\s*W\.?|N\.?\s*E\.?|S\.?\s*W\.?|S\.?\s*E\.?)\s*[0-9]+(?:st|nd|rd|th)\s+(?:Lane|Ln|Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Terrace|Ter|Place|Pl))\b/i },
  { field: 'easement', label: 'Easement', pattern: /\b([0-9]+'?\s*(?:foot\s*)?ingress\s*and\s*egress\s*easement)/i },
  { field: 'floodZone', label: 'Flood zone', pattern: /\bflood\s*zone\s+([A-Z]{1,2}[0-9]{0,2})\b/i },
  { field: 'legalDescription', label: 'Section/Township/Range', pattern: /\b(Section\s+[0-9]+,?\s*Township\s+[0-9]+\s*(?:South|North),?\s*Range\s+[0-9]+\s*(?:East|West))/i },
  { field: 'legalDescription', label: 'Platted lot', pattern: /\b(Lot\s+[0-9]+(?:\s+of\s+[A-Z][A-Z\s]+)?)\b/ },
  { field: 'grantor', label: 'Grantor', pattern: /BETWEEN\s*\n?([A-Z][A-Z\s.,]+?),?\s*(?:his|her|their)\s+wife|BETWEEN\s*\n?([A-Z][A-Z\s.,]{4,}?)\n/i },
  { field: 'grantee', label: 'Grantee', pattern: /parties of the first part,?\s*and\s*\n?([A-Z][A-Z\s.,]+?),?\s*(?:his|her|their)\s+wife/i },
  // Boundary geometry is deliberately NOT read by a loose regex over the page.
  // A distance is only meaningful once it is attached to the segment it
  // describes, so metes-and-bounds courses are parsed as segments below and a
  // dimension is never promoted to frontage on the strength of a number match.
];

// ── Boundary geometry: a dimension means nothing until it has a segment ────
//
// The defect this replaces was spatial, not textual. `459.67 feet to the
// centerline of NW 137th Lane` was read as road frontage because the road's
// name was next to the number. It is the opposite: a course that RUNS TO a
// centerline travels toward the road and is a side/depth line. The boundary
// that faces the road is the run that goes ALONG that centerline.
//
// A survey states this unambiguously in its own call language, so the geometry
// is read from the drawing's description rather than guessed from adjacency.
// Nothing is fetched and no model is called.

/** What a boundary segment is, relative to the parcel's frame. */
export type BoundarySegmentRole =
  | 'road_facing'
  | 'water_facing'
  | 'side_depth'
  | 'closing'
  /** A tie line from the section corner to the Point of Beginning. It locates
   *  the parcel and bounds nothing, so it is never a parcel dimension. */
  | 'tie_line'
  | 'unassociated';

export interface BoundarySegment {
  /** Exactly the distance the page states, in feet. */
  distanceFeet: number;
  /** The bearing the course carries, verbatim, when it states one. */
  bearing: string | null;
  role: BoundarySegmentRole;
  /** The feature the course runs along or terminates at, verbatim. */
  feature: string | null;
  /** The call the segment was read out of, for provenance. */
  callText: string;
}

const ROAD_FEATURE = /\b(?:lane|ln|street|st|road|rd|avenue|ave|drive|dr|terrace|ter|place|pl|highway|hwy|court|ct|trail|way|boulevard|blvd)\b/i;
const WATER_FEATURE = /\b(?:river|creek|branch|run|canal|lake|stream|slough|pond|bayou|ditch)\b/i;

function featureRole(feature: string | null): 'road' | 'water' | null {
  if (!feature) return null;
  if (WATER_FEATURE.test(feature)) return 'water';
  if (ROAD_FEATURE.test(feature)) return 'road';
  return null;
}

/**
 * Read a legal description into boundary segments with their roles.
 *
 * Courses are split on `thence` and on the numbered courses a survey uses for a
 * run along a centerline. Each course carries its own spatial relationship:
 *
 *  • `... N 76°45'51" W, 459.67 feet TO THE CENTERLINE OF NW 137th Lane`
 *    runs toward the road and terminates there — a side/depth boundary.
 *  • `... ALONG SAID CENTERLINE ... 69.20 feet` runs along the road — this is
 *    the road-facing boundary, and there may be several such courses.
 *  • `... 437.70 feet TO THE POINT OF BEGINNING` closes the figure.
 *
 * `along said centerline` inherits the feature named by the course that reached
 * it, which is how the survey itself reads: the antecedent is stated once.
 */
export function readBoundarySegments(text: string): BoundarySegment[] {
  const body = text.replace(/\s+/g, ' ');
  // Only read inside a metes-and-bounds description; a page without one has no
  // segments to attach dimensions to and must not produce guesses.
  if (!/point of beginning|point of commencement|thence/i.test(body)) return [];
  // Split on every course boundary a description actually uses. `From Point of
  // Beginning` starts a course without saying `thence`, and missing it merged
  // the last tie line with the first boundary line — which silently bound the
  // tie's distance to the boundary and dropped the boundary's own.
  const parts = body
    .split(/(?=\bthence\b)|(?=\b[0-9]\)\s)|(?=\bfrom\s+point\s+of\s+beginning\b)/i)
    .map((p) => p.trim())
    .filter(Boolean);
  const segments: BoundarySegment[] = [];
  let alongFeature: string | null = null;
  // Everything before the Point of Beginning is the tie from the section corner
  // that locates the parcel. Those courses bound nothing, and counting them as
  // boundary is how a 932.98 ft tie line becomes the parcel's longest "side".
  let atBoundary = !/point of beginning/i.test(body);
  for (const part of parts) {
    const distanceMatch = /([0-9]+(?:\.[0-9]+)?)\s*feet/i.exec(part);
    if (!distanceMatch) continue;
    const distanceFeet = Number.parseFloat(distanceMatch[1]);
    if (!Number.isFinite(distanceFeet)) continue;
    const bearing = /((?:North|South)\s+[0-9]+\s+degrees(?:,)?\s*[0-9]+\s+minutes(?:,)?\s*(?:and\s*)?[0-9]+\s+seconds\s+(?:East|West))/i.exec(part)?.[1]?.trim() ?? null;
    const toFeature = /to\s+the\s+centerline\s+of\s+([A-Za-z0-9.'\- ]+?)(?:\s*[;,.]|\s+thence|$)/i.exec(part)?.[1]?.trim() ?? null;
    const along = /along\s+(?:said\s+centerline|the\s+centerline\s+of\s+([A-Za-z0-9.'\- ]+?))(?:\s*[;,.]|\s+following|$)/i.exec(part);
    const closes = /to\s+the\s+point\s+of\s+beginning/i.test(part);

    // The course that ENDS at the Point of Beginning is the last tie line; the
    // boundary starts with the course after it.
    const wasBoundary = atBoundary;
    if (/for\s+the\s+point\s+of\s+beginning|from\s+point\s+of\s+beginning/i.test(part)) atBoundary = true;

    let role: BoundarySegmentRole;
    let feature: string | null = null;
    if (!wasBoundary && !/from\s+point\s+of\s+beginning/i.test(part)) {
      role = 'tie_line';
      segments.push({ distanceFeet, bearing, role, feature: null, callText: part.slice(0, 240).trim() });
      continue;
    }
    if (along) {
      // Runs ALONG the feature: this is the boundary that faces it.
      feature = (along[1]?.trim() ?? alongFeature) ?? null;
      alongFeature = feature ?? alongFeature;
      const kind = featureRole(feature);
      role = kind === 'water' ? 'water_facing' : kind === 'road' ? 'road_facing' : 'unassociated';
    } else if (toFeature) {
      // Runs TO the feature: a depth line reaching it, never frontage on it.
      feature = toFeature;
      alongFeature = toFeature;
      role = 'side_depth';
    } else if (closes) {
      role = 'closing';
      // A closing course still bounds the parcel; it is a side/depth line that
      // happens to return to the start.
    } else if (/leaving\s+said\s+centerline/i.test(part)) {
      role = 'side_depth';
      alongFeature = null;
    } else if (alongFeature && /^\s*[0-9]\)/.test(part)) {
      // A numbered course inside a stated run along a centerline.
      feature = alongFeature;
      const kind = featureRole(feature);
      role = kind === 'water' ? 'water_facing' : kind === 'road' ? 'road_facing' : 'unassociated';
    } else {
      role = 'side_depth';
    }
    segments.push({ distanceFeet, bearing, role, feature, callText: part.slice(0, 240).trim() });
  }
  return segments;
}

/**
 * What the survey establishes about the parcel's frame, kept separate from what
 * a provider reports.
 */
export interface BoundaryFrontageReconciliation {
  segments: BoundarySegment[];
  /** Total run along the road centerline the survey describes, when it does. */
  surveyedRoadFacingFeet: number | null;
  /** The road the surveyed road-facing run is along, verbatim. */
  roadFeature: string | null;
  /** Provider/mapped frontage, retained as its own distinct measurement. */
  providerFrontageFeet: number | null;
  providerFrontageLabel: string | null;
  /** The longest side/depth line, the figure most often misread as frontage. */
  longestSideDepthFeet: number | null;
  reason: string;
}

export function reconcileBoundaryFrontage(input: {
  segments: BoundarySegment[];
  providerFrontageFeet: number | null;
  providerFrontageLabel: string | null;
}): BoundaryFrontageReconciliation | null {
  const { segments } = input;
  if (!segments.length && input.providerFrontageFeet == null) return null;
  const roadFacing = segments.filter((s) => s.role === 'road_facing');
  const sideDepth = segments.filter((s) => s.role === 'side_depth' || s.role === 'closing');
  const surveyedRoadFacingFeet = roadFacing.length
    ? Math.round(roadFacing.reduce((sum, s) => sum + s.distanceFeet, 0) * 100) / 100
    : null;
  const roadFeature = roadFacing.find((s) => s.feature)?.feature ?? null;
  const longestSideDepthFeet = sideDepth.length
    ? Math.max(...sideDepth.map((s) => s.distanceFeet))
    : null;

  const notes: string[] = [];
  if (longestSideDepthFeet != null) {
    const line = sideDepth.find((s) => s.distanceFeet === longestSideDepthFeet);
    notes.push(
      `${longestSideDepthFeet} ft is the longest side/depth boundary`
      + (line?.feature ? `, the course running to the centerline of ${line.feature}` : '')
      + '. A course that runs TO a centerline crosses the parcel toward the road; it is not frontage along it.',
    );
  }
  if (surveyedRoadFacingFeet != null) {
    notes.push(
      `The survey's road-facing boundary is the ${roadFacing.length} course${roadFacing.length === 1 ? '' : 's'} run along the`
      + `${roadFeature ? ` ${roadFeature}` : ''} centerline, totalling ${surveyedRoadFacingFeet} ft as measured along that line.`,
    );
  }
  if (input.providerFrontageFeet != null) {
    notes.push(
      `${input.providerFrontageFeet} ft is ${input.providerFrontageLabel ?? 'the provider'}'s mapped road frontage, a separate measurement `
      + 'computed from the parcel polygon. Both are kept and labeled; neither replaces the other, and neither establishes a recorded legal right of access.',
    );
  }
  return {
    segments,
    surveyedRoadFacingFeet,
    roadFeature,
    providerFrontageFeet: input.providerFrontageFeet,
    providerFrontageLabel: input.providerFrontageLabel,
    longestSideDepthFeet,
    reason: notes.join(' '),
  };
}

function excerptFor(text: string, matchIndex: number): string {
  const start = text.lastIndexOf('\n', matchIndex) + 1;
  const end = text.indexOf('\n', matchIndex);
  return text.slice(start, end === -1 ? text.length : end).trim().slice(0, 240);
}

function normalizeApn(value: string): string {
  return value.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
}

/** Read the claims one already-interpreted page supports. No model call. */
export function claimsFromArtifact(
  artifact: RetainedEvidenceArtifact,
  provenance: EvidenceClaimProvenance,
): Array<Omit<EvidenceClaim, 'relation' | 'reason' | 'parcelRelationship'>> {
  if (!artifact.exactText.trim()) return [];
  const text = artifact.exactText;
  const out: Array<Omit<EvidenceClaim, 'relation' | 'reason' | 'parcelRelationship'>> = [];
  const seen = new Set<string>();
  for (const spec of CLAIM_PATTERNS) {
    if (spec.kinds && !spec.kinds.includes(provenance.documentKind)) continue;
    const match = spec.pattern.exec(text);
    if (!match) continue;
    const raw = (match[spec.group ?? 1] ?? match[2] ?? '').trim();
    if (!raw) continue;
    const value = raw.replace(/\s+/g, ' ').trim();
    const key = `${spec.field}:${value.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      field: spec.field,
      label: spec.label,
      value,
      excerpt: excerptFor(text, match.index),
      provenance,
      // A recorded instrument or a sealed survey read cleanly off the page is
      // good evidence; a page the extraction itself called partial is not
      // promoted past `likely` on the strength of a regex.
      weight: artifact.extractionStatus === 'complete' ? 'well_supported' : 'likely',
    });
  }
  // Boundary dimensions, each bound to the segment it actually describes. The
  // role is what makes the number mean anything, so it is carried in the label
  // the operator reads rather than left to inference.
  if (provenance.documentKind === 'survey' || provenance.documentKind === 'deed') {
    for (const segment of readBoundarySegments(text)) {
      if (segment.role === 'unassociated' || segment.role === 'tie_line') continue;
      const value = `${segment.distanceFeet} ft`;
      const label = segment.role === 'road_facing'
        ? `Road-facing boundary along the ${segment.feature ?? 'road'} centerline`
        : segment.role === 'water_facing'
          ? `Water-facing boundary along ${segment.feature ?? 'the watercourse'}`
          : segment.role === 'closing'
            ? 'Side/depth boundary closing to the Point of Beginning'
            : `Side/depth boundary${segment.feature ? ` running to the centerline of ${segment.feature}` : ''}`;
      const key = `dimension:${label.toLowerCase()}:${value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        field: 'dimension',
        label,
        value,
        excerpt: segment.callText,
        provenance,
        weight: artifact.extractionStatus === 'complete' ? 'well_supported' : 'likely',
      });
    }
  }

  // Candidates the extraction already normalized are claims too, and they carry
  // the same page. Owner is the one worth lifting: it is stated, not inferred.
  const owner = artifact.candidates.owner?.trim();
  if (owner && !seen.has(`owner:${owner.toLowerCase()}`)) {
    out.push({
      field: 'owner',
      label: 'Owner named on the document',
      value: owner,
      excerpt: excerptFor(text, Math.max(0, text.toUpperCase().indexOf(owner.toUpperCase().slice(0, 12)))),
      provenance,
      weight: 'likely',
    });
  }
  return out;
}

// ── Reconciliation against the Deal's working conclusion ───────────────────

function sameApn(a: string, b: string): boolean {
  return normalizeApn(a) === normalizeApn(b);
}

const NAME_SUFFIX = /\b(?:JR|SR|II|III|IV|V)\b/g;

/**
 * Are these two strings plausibly the same person written two ways?
 *
 * `HILL EUGENE W` (assessor, surname-first) and `EUGENE W. HILL, JR.` (deed,
 * given-name-first with a suffix) are one owner. Treating them as two people
 * because of comma placement manufactured a contradiction out of formatting.
 *
 * The test is deliberately narrow: drop punctuation and suffixes, drop bare
 * middle initials, then compare the remaining name tokens as a set. That
 * recognizes reordering and initials without inferring anything about
 * relationships, households, or entities — two genuinely different people still
 * fail it, because their surnames differ.
 */
export function likelySameOwnerName(a: string, b: string): boolean {
  const tokens = (value: string): Set<string> => new Set(
    value.toUpperCase()
      .replace(/[.,]/g, ' ')
      .replace(NAME_SUFFIX, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 1 && /^[A-Z]+$/.test(token)),
  );
  const left = tokens(a);
  const right = tokens(b);
  if (!left.size || !right.size) return false;
  const smaller = left.size <= right.size ? left : right;
  const larger = smaller === left ? right : left;
  let shared = 0;
  for (const token of smaller) if (larger.has(token)) shared += 1;
  // Every name word of the shorter form must appear in the longer one. A deed
  // naming a spouse the assessor does not carry still matches; a different
  // surname does not.
  return shared === smaller.size && shared >= 1;
}

/**
 * Decide which parcel a page is about, from the page itself.
 *
 * A page carrying a parcel identifier that normalizes to the canonical subject
 * IS subject evidence — the operator supplied it as the subject survey and the
 * document names the same parcel, so there is nothing left to resolve. A page
 * carrying a DIFFERENT identifier is about a different parcel; in a known
 * multi-parcel ownership group the honest label is an unresolved relationship,
 * not a contradiction, and it never touches subject facts either way.
 */
export function classifyPageParcelRelationship(
  claims: Array<Pick<EvidenceClaim, 'field' | 'value'>>,
  canonicalApn: string | null,
): { relationship: ClaimParcelRelationship; statedApn: string | null } {
  const apnClaim = claims.find((claim) => claim.field === 'apn');
  if (!apnClaim) return { relationship: 'unresolved_relationship', statedApn: null };
  if (!canonicalApn) return { relationship: 'unresolved_relationship', statedApn: apnClaim.value };
  return sameApn(apnClaim.value, canonicalApn)
    ? { relationship: 'subject', statedApn: apnClaim.value }
    : { relationship: 'unresolved_relationship', statedApn: apnClaim.value };
}

/**
 * Say what each claim does to the Deal, without doing it.
 *
 * Canonical state is LandOS's current best-supported working conclusion, so a
 * contradicting page does not lose and does not win: it is marked
 * `contradicts`, which is what makes a specialist investigate it.
 */
export function reconcileClaim(
  claim: Omit<EvidenceClaim, 'relation' | 'reason' | 'parcelRelationship'>,
  state: DealWorkingState,
  parcelRelationship: ClaimParcelRelationship,
): EvidenceClaim {
  const settled = (relation: EvidenceClaimRelation, reason: string): EvidenceClaim => ({
    ...claim, relation, reason, parcelRelationship,
  });

  // A claim about another parcel is evidence about THAT parcel. It is retained
  // with its page and its relationship, and it is never reconciled against
  // subject facts — that comparison is what turned an adjoining parcel's deed
  // into a subject contradiction. Invariant 4 is the rule: facts from another
  // parcel are never evidence for the subject, in either direction.
  if (parcelRelationship !== 'subject' && claim.field !== 'apn') {
    return settled(
      'adds',
      'Read from a page that names a parcel other than the subject, so it is retained as evidence about that parcel and changes nothing on this Deal.',
    );
  }

  switch (claim.field) {
    case 'apn': {
      if (!state.apn) return settled('adds', 'The Deal carries no canonical parcel identifier yet, so this is the first one on record.');
      if (sameApn(claim.value, state.apn)) {
        return settled('supports', `Matches the canonical subject ${state.apn} after normalization, so this page is subject-specific evidence.`);
      }
      // Different parcel, not a disagreement about this one. The sellers hold
      // three adjoining parcels and are keeping two, so a packet document
      // naming another parcel is expected. It is preserved exactly, its
      // relationship is open, and it overwrites nothing.
      return settled(
        'unresolved',
        `Names parcel ${claim.value}, which is not the subject ${state.apn}. `
        + 'The sellers hold adjoining parcels, so this most likely describes a related parcel rather than disagreeing about this one. '
        + 'The reference is preserved exactly and its relationship to the subject is unresolved; it does not change subject identity.',
      );
    }
    case 'acreage': {
      const acres = Number.parseFloat(claim.value);
      if (!Number.isFinite(acres)) return settled('unresolved', 'The acreage on the page could not be read as a number.');
      if (state.acreage == null) return settled('adds', 'The Deal had no stated acreage from a document until this page.');
      const spread = Math.abs(acres - state.acreage);
      if (spread < 0.01) return settled('supports', `Matches the Deal's working acreage of ${state.acreage}.`);
      return settled(
        'contradicts',
        `States ${acres} acres against the Deal's working ${state.acreage}. Whether that is a real disagreement or two different measurements is settled by basis, not by preference.`,
      );
    }
    case 'owner':
    case 'grantee': {
      if (!state.owner) return settled('adds', 'The Deal had no owner of record from a document until this page.');
      if (likelySameOwnerName(claim.value, state.owner)) {
        return settled(
          'supports',
          `Names ${claim.value}, the same owner the Deal carries as ${state.owner}, written in a different order with punctuation and a suffix. Both exact strings are preserved.`,
        );
      }
      return settled('contradicts', `Names ${claim.value} where the Deal carries ${state.owner}.`);
    }
    case 'roadName': {
      if (!state.roadName) return settled('adds', 'Names the road the parcel fronts; the Deal had no road from a document.');
      const same = claim.value.replace(/[^a-z0-9]/gi, '').toUpperCase()
        === state.roadName.replace(/[^a-z0-9]/gi, '').toUpperCase();
      return same
        ? settled('supports', `Matches the road already on the Deal, ${state.roadName}.`)
        : settled('adds', `Names ${claim.value}; the Deal carries ${state.roadName}. Both are retained as physical evidence.`);
    }
    case 'grantor':
      return settled('adds', 'Establishes who conveyed the parcel, which the Deal did not carry from a document.');
    case 'dimension':
      // A measured boundary segment, already bound to the edge it describes.
      // It is physical geometry: it says where the parcel's edge runs, never
      // that a right to use the road it reaches has been granted.
      return settled(
        'adds',
        `${claim.label} measured on the survey. It establishes where that boundary runs, not whether legal access is granted.`,
      );
    case 'roadFrontage':
    case 'surveyBoundary':
      // Physical/mapped evidence. It never establishes a legal right of access:
      // that needs deed, survey, or title language granting it, and a boundary
      // call reaching a centerline is geometry, not a grant.
      return settled('adds', 'Surveyed physical evidence. It describes where the boundary runs, not whether legal access is granted.');
    case 'easement':
      return settled('adds', 'An easement shown on the survey. Whether it benefits this parcel is a title question the survey does not answer.');
    default:
      return settled('adds', 'Recorded on the Deal as document-supplied evidence with its exact page.');
  }
}

/**
 * Trace two acreages to what they each measure.
 *
 * Neither number is assumed correct. A survey figure read off a sealed sheet
 * and a provider/GIS figure computed from a polygon are different measurements
 * of the same parcel, and when both are legitimate both are kept with labels.
 * The working acreage is chosen by which basis the strategy math should stand
 * on, and the reason is stated rather than implied.
 */
export function reconcileAcreageProvenance(input: {
  claims: EvidenceClaim[];
  providerAcres: number | null;
  providerLabel: string | null;
  /** What the parcel RECORD reports, as distinct from area computed off a map. */
  parcelRecordAcres?: number | null;
  parcelRecordLabel?: string | null;
}): AcreageProvenanceReconciliation | null {
  const entries: AcreageProvenanceReconciliation['entries'] = [];
  for (const claim of input.claims) {
    if (claim.field !== 'acreage') continue;
    const acres = Number.parseFloat(claim.value);
    if (!Number.isFinite(acres)) continue;
    // Only the subject's own pages contribute a subject acreage basis.
    if (claim.parcelRelationship !== 'subject') continue;
    const kind = claim.provenance.documentKind;
    const basis = kind === 'survey' ? 'survey' : kind === 'deed' ? 'deed' : 'unknown';
    if (entries.some((e) => e.basis === basis && Math.abs(e.acres - acres) < 0.001)) continue;
    entries.push({
      acres,
      basis,
      label: basis === 'survey' ? 'Surveyed acreage' : basis === 'deed' ? 'Deed-stated acreage' : 'Document-stated acreage',
      source: `${claim.provenance.pageLabel} (${claim.provenance.fileName})`,
      artifactId: claim.provenance.artifactId,
    });
  }
  if (input.parcelRecordAcres != null && Number.isFinite(input.parcelRecordAcres)) {
    entries.push({
      acres: input.parcelRecordAcres,
      basis: 'provider',
      label: 'Parcel-record acreage',
      source: input.parcelRecordLabel ?? 'Provider parcel record',
      artifactId: null,
    });
  }
  if (input.providerAcres != null && Number.isFinite(input.providerAcres)) {
    entries.push({
      acres: input.providerAcres,
      basis: 'gis_calculated',
      label: 'Provider / GIS-calculated acreage',
      source: input.providerLabel ?? 'Provider parcel record',
      artifactId: null,
    });
  }
  if (!entries.length) return null;

  // Strength order, and the reason for it. A field-run boundary outranks a
  // deed's recital, which outranks what a parcel record reports, which outranks
  // an area computed from a digitized polygon. The last of those is the only
  // one not measured against the parcel itself, which is why it is never the
  // working figure when anything better is on record — and why a Deal with no
  // survey at all still prefers its parcel record over its map geometry.
  const surveyed = entries.find((e) => e.basis === 'survey');
  const documentEntry = surveyed
    ?? entries.find((e) => e.basis === 'deed')
    ?? entries.find((e) => e.basis === 'provider');
  const computed = entries.find((e) => e.basis === 'gis_calculated');

  if (documentEntry && computed && Math.abs(documentEntry.acres - computed.acres) >= 0.01) {
    return {
      entries,
      workingAcres: documentEntry.acres,
      workingBasis: documentEntry.label,
      bothLegitimate: true,
      reason:
        `${documentEntry.acres} acres is measured on the ground and stated on ${documentEntry.source}; `
        + `${computed.acres} acres is computed from ${computed.source}, which follows a digitized polygon and commonly `
        + 'includes area to a road centerline the deeded parcel does not own. Both are kept and labeled. '
        + `Working acreage is the ${documentEntry.label.toLowerCase()} because a field-run boundary is the stronger basis for strategy math.`,
    };
  }
  const only = documentEntry ?? computed ?? entries[0];
  return {
    entries,
    workingAcres: only.acres,
    workingBasis: only.label,
    bothLegitimate: false,
    reason: entries.length === 1
      ? `Only one acreage basis is on record: ${only.label.toLowerCase()} from ${only.source}.`
      : `The acreage figures on record agree within tolerance; working acreage is the ${only.label.toLowerCase()}.`,
  };
}

/**
 * The whole pass: already-retained artifacts in, grouped and reconciled claims
 * out. Nothing is fetched, nothing is re-read, nothing is overwritten.
 */
export function interpretDealEvidence(input: {
  artifacts: RetainedEvidenceArtifact[];
  state: DealWorkingState;
  providerAcres?: number | null;
  providerAcreageLabel?: string | null;
  providerFrontageFeet?: number | null;
  providerFrontageLabel?: string | null;
  parcelRecordAcres?: number | null;
  parcelRecordLabel?: string | null;
}): DealEvidenceInterpretation {
  const { groups, kindOf, pageLabelOf } = groupEvidenceDocuments(input.artifacts);
  const claims: EvidenceClaim[] = [];
  const subjectSegments: BoundarySegment[] = [];
  const unreadable: DealEvidenceInterpretation['unreadable'] = [];
  const pageParcel = new Map<number, { relationship: ClaimParcelRelationship; statedApn: string }>();

  interface PendingPage {
    artifact: RetainedEvidenceArtifact;
    provenance: EvidenceClaimProvenance;
    raw: Array<Omit<EvidenceClaim, 'relation' | 'reason' | 'parcelRelationship'>>;
    relationship: ClaimParcelRelationship;
    statedApn: string | null;
  }
  const pending: PendingPage[] = [];

  for (const artifact of input.artifacts) {
    const documentKind = kindOf.get(artifact.artifactId) ?? 'unknown';
    if (documentKind === 'unreadable') {
      unreadable.push({
        artifactId: artifact.artifactId,
        fileName: artifact.fileName,
        reason: 'Retained exactly as supplied. The page could not be interpreted, so nothing is claimed from it.',
      });
      continue;
    }
    const provenance: EvidenceClaimProvenance = {
      artifactId: artifact.artifactId,
      uploadId: artifact.uploadId,
      fileName: artifact.fileName,
      pageLabel: pageLabelOf.get(artifact.artifactId) ?? artifact.fileName,
      groupLabel: GROUP_LABEL[documentKind],
      documentKind,
      sourceType: 'operator_supplied_document',
      capturedAt: artifact.capturedAt,
    };
    // Two passes over one page: read what it says, decide which parcel it is
    // about, then reconcile. The parcel question must be settled BEFORE any
    // claim is compared to the Deal, or a related parcel's facts get judged as
    // though they were the subject's.
    const raw = claimsFromArtifact(artifact, provenance);
    const { relationship, statedApn } = classifyPageParcelRelationship(raw, input.state.apn);
    if (statedApn) pageParcel.set(artifact.artifactId, { relationship, statedApn });
    pending.push({ artifact, provenance, raw, relationship, statedApn });
  }

  // A multi-page instrument states its parcel ONCE.
  //
  // A survey stamps the parcel number on its face sheet; page 2 carries the
  // metes and bounds, the acreage and the flood zone and names no parcel at
  // all. Classifying that page on its own made every fact it carries read as
  // "a parcel other than the subject", which is the opposite of true — and it
  // is how a survey's own acreage failed to reach the subject that survey
  // describes. So a page that names NO parcel inherits the parcel its own
  // document group named, and only when the group named exactly one. A bundle
  // holding two different instruments inherits nothing and stays unresolved,
  // because there is no single answer to inherit.
  const statedByGroup = new Map<string, Set<string>>();
  for (const page of pending) {
    if (!page.statedApn) continue;
    const key = page.provenance.groupLabel;
    statedByGroup.set(key, (statedByGroup.get(key) ?? new Set()).add(normalizeApn(page.statedApn)));
  }
  for (const page of pending) {
    if (page.statedApn) continue;
    const stated = statedByGroup.get(page.provenance.groupLabel);
    if (!stated || stated.size !== 1) continue;
    const donor = pending.find((other) => other.statedApn && normalizeApn(other.statedApn) === [...stated][0]);
    if (donor) page.relationship = donor.relationship;
  }

  for (const page of pending) {
    // Only the subject's own pages describe the subject's boundary. A related
    // parcel's legal description is retained on its own page and never folded
    // into the subject's frame — invariant 4, in the geometry.
    if (page.relationship === 'subject'
        && (page.provenance.documentKind === 'survey' || page.provenance.documentKind === 'deed')) {
      subjectSegments.push(...readBoundarySegments(page.artifact.exactText));
    }
    for (const item of page.raw) {
      claims.push(reconcileClaim(item, input.state, page.relationship));
    }
  }

  const acreage = reconcileAcreageProvenance({
    claims,
    providerAcres: input.providerAcres ?? null,
    providerLabel: input.providerAcreageLabel ?? null,
    parcelRecordAcres: input.parcelRecordAcres ?? null,
    parcelRecordLabel: input.parcelRecordLabel ?? null,
  });

  const boundary = reconcileBoundaryFrontage({
    segments: subjectSegments,
    providerFrontageFeet: input.providerFrontageFeet ?? null,
    providerFrontageLabel: input.providerFrontageLabel ?? null,
  });

  // Only the subject's own pages can satisfy or contest the subject's
  // requirements. A related parcel's deed is preserved and reported, and it is
  // excluded from both sides of the coverage decision.
  const subjectClaims = claims.filter((c) => c.parcelRelationship === 'subject');
  const relatedParcelReferences = [...pageParcel.entries()]
    .filter(([, value]) => value.relationship !== 'subject')
    .map(([artifactId, value]) => ({
      artifactId,
      statedApn: value.statedApn,
      relationship: value.relationship,
      pageLabel: pageLabelOf.get(artifactId) ?? String(artifactId),
    }));

  const openContradictions = subjectClaims.filter((c) => c.relation === 'contradicts');
  // A field is settled only when a page speaks to it and nothing contradicts it.
  // A contradiction is the opposite of coverage: it opens work, never closes it.
  const contradicted = new Set(openContradictions.map((c) => c.field));
  const satisfiedFields = [...new Set(
    subjectClaims.filter((c) => (c.relation === 'supports' || c.relation === 'adds') && !contradicted.has(c.field))
      .map((c) => c.field),
  )];

  return {
    groups,
    claims,
    unreadable,
    acreage,
    boundary,
    satisfiedFields,
    openContradictions,
    relatedParcelReferences,
    narrative: buildEvidenceNarrative({
      groups, claims, unreadable, acreage, boundary, openContradictions, relatedParcelReferences,
    }),
  };
}

/**
 * What Smart Intake says back, built from what was actually read.
 *
 * Every clause below is derived from a real claim or a real group count. There
 * is no template sentence that survives when the evidence does not support it.
 */
export function buildEvidenceNarrative(input: {
  groups: EvidenceDocumentGroup[];
  claims: EvidenceClaim[];
  unreadable: DealEvidenceInterpretation['unreadable'];
  acreage: AcreageProvenanceReconciliation | null;
  boundary?: BoundaryFrontageReconciliation | null;
  openContradictions: EvidenceClaim[];
  relatedParcelReferences: DealEvidenceInterpretation['relatedParcelReferences'];
}): string {
  const pages = input.groups.reduce((sum, g) => sum + g.pageCount, 0);
  if (!pages) return 'No retained evidence pages were available to interpret.';
  const parts: string[] = [];
  const named = input.groups
    .filter((g) => g.kind !== 'unreadable')
    .map((g) => `${g.pageCount} ${g.kind === 'deed' ? 'a deed' : g.kind === 'survey' ? 'a survey' : g.kind === 'recording_receipt' ? 'a recording receipt' : 'an unlabeled document'}`);
  parts.push(
    `I read ${pages} seller-supplied page${pages === 1 ? '' : 's'} already on this deal`
    + (named.length ? `. ${named.join('; ')}.` : '.'),
  );

  const subject = input.claims.filter((c) => c.parcelRelationship === 'subject');
  const supports = subject.filter((c) => c.relation === 'supports');
  if (supports.length) {
    const top = supports.slice(0, 3).map((c) => `${c.label.toLowerCase()} ${c.value}`);
    parts.push(`The subject survey supports ${top.join(', ')}.`);
  }
  const adds = subject.filter((c) => c.relation === 'adds');
  if (adds.length) {
    const top = adds.slice(0, 3).map((c) => `${c.label.toLowerCase()} ${c.value}`);
    parts.push(`New from the documents: ${top.join(', ')}.`);
  }
  for (const related of input.relatedParcelReferences.slice(0, 2)) {
    parts.push(
      `${related.pageLabel} references parcel ${related.statedApn}, which is not the subject. `
      + 'The sellers hold adjoining parcels, so I am treating that relationship as unresolved rather than changing the subject.',
    );
  }
  for (const conflict of input.openContradictions.slice(0, 2)) {
    parts.push(`${conflict.provenance.pageLabel} conflicts: ${conflict.reason}`);
  }
  if (input.acreage?.bothLegitimate) {
    parts.push(input.acreage.reason);
  }
  if (input.boundary?.reason) {
    parts.push(input.boundary.reason);
  }
  if (input.unreadable.length) {
    parts.push(
      `${input.unreadable.length} page${input.unreadable.length === 1 ? ' was' : 's were'} kept but could not be read, so I claim nothing from ${input.unreadable.length === 1 ? 'it' : 'them'}.`,
    );
  }
  return parts.join(' ');
}
