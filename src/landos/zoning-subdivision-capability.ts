// LandOS — Zoning + Subdivision Capability.
//
// This is a PLACEMENT, not a new zoning engine and not a new ordinance
// platform. The nationwide land-use engine, the controlling-authority race, the
// current-zoning determination, the subdivision-regulation retrieval and the
// deterministic property subdivision read all already exist and are accepted.
// This module is the runtime Capability envelope around them, so Tools, New
// Lead and the V2 Deal Card reach ONE land-use implementation through one
// contract.
//
// The question this capability answers is a LOCATION question:
//
//     "What rules apply to this property because of WHERE IT IS?"
//
// That is why its rule package is JURISDICTION-scoped and reusable by any other
// property the same government controls, and why property-specific planning
// history is a different capability (`property-development-history`) rather
// than a section of this one. The two share search, official-document
// discovery, retrieval and evidence infrastructure; they do not share business
// truth, and a rule package may never carry another parcel's history.
//
// The existing execution paths it wraps, reused verbatim:
//
//   1. The retained land-use record — `getLandUseDetermination()` for the
//      nationwide engine's own determination, plus the post-resolution lanes'
//      retained authority, current zoning, subdivision regulations and property
//      subdivision read. All SELECTs: they read what LandOS already
//      established and compute nothing new about the parcel.
//   2. The live land-use research lane (`runLandUseResearch`), which is what
//      performs jurisdiction resolution, early web search for the authoritative
//      government source, official-document retrieval and rule extraction. It
//      reaches the network, so the route layer INJECTS it — the capability owns
//      the invocation, not the transport.
//
// Hard rules carried over from the underlying implementation:
//   - The canonical subject comes from Property Resolution. This capability
//     never decides that a different parcel is the subject; on raw input it
//     delegates to the Property Resolution Capability and consumes what that
//     returns, creating no lead, Property Card or Deal Card of its own.
//   - The subdivision-by-right result is APPLIED, never guessed. It is read off
//     `computeLegalYield`'s deterministic output and the deterministic property
//     subdivision read; when an input is missing the status says so instead of
//     a model filling in a lot count.
//   - A classification that is not adopted zoning stays labelled as such, and a
//     historical or requested district never becomes the current district.
//   - Every rule keeps the official source URL and section that carried it.

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
import { getDealCardIdForPropertyCard } from './deal-card.js';
import { getLandUseDetermination } from './land-use-store.js';
import {
  readControllingAuthority,
  readCurrentZoning,
  readPropertySubdivisionRead,
  readSubdivisionRegulations,
} from './land-use-intelligence-store.js';
import { readRegulationDocuments, type RegulationJurisdiction } from './regulation-document-store.js';
import { PROPERTY_RESOLUTION_CAPABILITY_ID } from './property-resolution-capability.js';
import { evaluateResolverIdentity, readResolverSubject } from './universal-property-resolution.js';
import type { EvidencedValue, LandUseDetermination, LegalSourceCitation } from './land-use-types.js';
import type { ControllingLandUseAuthority } from './controlling-land-use-authority.js';
import type { CurrentZoningDetermination } from './current-zoning-determination.js';
import type { SubdivisionRegulations } from './subdivision-regulations.js';
import type { PropertySubdivisionRead } from './subdivision-property-read.js';

export const ZONING_SUBDIVISION_CAPABILITY_ID = 'zoning-subdivision';

/**
 * The two existing execution paths, named.
 *
 * `retained_rules` is the default because it answers for every caller with no
 * network, no search and no government host: it reads the rule package and the
 * subdivision read LandOS already established for this jurisdiction and parcel.
 */
export type ZoningSubdivisionLane = 'retained_rules' | 'research';

export type ZoningSubdivisionOutcome =
  | 'rules_returned'
  | 'lane_completed'
  | 'retained_only'
  | 'not_available';

/**
 * The subdivision-by-right result, as a STATUS rather than a bare number.
 *
 * Every value here is decided by the deterministic yield computation and the
 * deterministic property subdivision read. Nothing in this capability lets a
 * language model choose one.
 */
export type SubdivisionByRightStatus =
  | 'SUPPORTED'
  | 'CONDITIONAL'
  | 'INSUFFICIENT_INFORMATION'
  | 'UNRESOLVED'
  | 'NOT_APPLICABLE';

const BY_RIGHT_STATUS_LABEL: Record<SubdivisionByRightStatus, string> = {
  SUPPORTED: 'Subdivision by right supported',
  CONDITIONAL: 'Subdivision by right conditional',
  INSUFFICIENT_INFORMATION: 'Insufficient information for a by-right result',
  UNRESOLVED: 'Subdivision by right unresolved',
  NOT_APPLICABLE: 'Subdivision by right does not apply on this path',
};

/** What the injected live land-use research lane reports back. */
export type LandUseResearchOutcome = {
  ran: boolean;
  lanes: Array<{ lane: string; status: string; durationMs: number }>;
  summary: string;
};

export interface ZoningSubdivisionRuntime {
  /**
   * Raw operator input is resolved by the Property Resolution Capability, never
   * here. The registry injects the real invoker; tests inject a stub.
   */
  resolveSubject?: (request: CapabilityInvocationRequest) => Promise<CapabilityResult>;
  /**
   * The existing live land-use research lane, owned by the route layer because
   * it reaches search engines and government hosts.
   */
  runLandUseResearch?: (input: { propertyCardId: number; dealCardId: number }) => Promise<LandUseResearchOutcome>;
  /** Retained reads. Injectable so a unit test needs no database. */
  readDetermination?: (dealCardId: number) => { determination: LandUseDetermination; determinedAt: string } | null;
  readAuthority?: (dealCardId: number) => ControllingLandUseAuthority | null;
  readZoning?: (dealCardId: number) => CurrentZoningDetermination | null;
  readRegulations?: (dealCardId: number) => SubdivisionRegulations | null;
  readSubdivisionRead?: (dealCardId: number) => PropertySubdivisionRead | null;
  /** The jurisdiction-scoped retained regulation set, reusable across parcels. */
  readJurisdictionDocuments?: (jurisdiction: RegulationJurisdiction) => Array<{ url: string; label: string }>;
}

/** One land-use rule, with the official source that carried it. */
export type LandUseRuleFact = {
  key: string;
  label: string;
  value: string | null;
  unresolved: string | null;
  section: string | null;
  sourceLabel: string | null;
  sourceUrl: string | null;
  authorityName: string | null;
  confidence: string;
  /** Always `jurisdiction`: a rule is true because of WHERE the parcel is. */
  scope: 'jurisdiction';
};

export type ZoningSubdivisionAuthorityFact = {
  role: string;
  name: string | null;
  level: string | null;
  determination: string;
  basis: string | null;
  officialUrl: string | null;
};

export type ZoningSubdivisionSourceFact = {
  title: string;
  sourceType: string;
  url: string | null;
  jurisdiction: string | null;
  date: string | null;
  section: string | null;
  retrievedAt: string | null;
};

export type ZoningSubdivisionJurisdictionFacts = {
  county: string | null;
  state: string | null;
  municipality: string | null;
  incorporationStatus: string | null;
  authorityPattern: string | null;
  authorities: ZoningSubdivisionAuthorityFact[];
  /**
   * The stable key the jurisdiction's rule package is retained under. Any other
   * property this government controls reuses the same package; it is null
   * whenever the controlling authority is not established, because a package
   * filed against the wrong government would be served to the wrong parcels.
   */
  rulePackageKey: string | null;
  rulePackageReused: boolean;
  retainedJurisdictionDocuments: Array<{ label: string; url: string }>;
};

export type ZoningSubdivisionZoningFacts = {
  established: boolean;
  districtCode: string | null;
  districtName: string | null;
  presence: string | null;
  statement: string;
  confidence: string;
  governingAuthority: string | null;
  /** A code that is NOT adopted zoning, retained and labelled rather than promoted. */
  nonZoningClassification: { code: string; description: string | null; sourceUrl: string | null } | null;
  /** Historical or requested districts. NEVER the district in force today. */
  historicalReferences: Array<{ kind: string; value: string | null; asOf: string | null; sourceUrl: string | null; neverEstablishesCurrentZoning: true }>;
  limitations: string[];
};

export type SubdivisionByRightFacts = {
  status: SubdivisionByRightStatus;
  statusLabel: string;
  maximumLots: number | null;
  path: string | null;
  reviewBody: string | null;
  reviewIndication: string | null;
  basis: string;
  calculation: string | null;
  /** Every constraint the deterministic computation actually applied. */
  constraintsApplied: Array<{ constraint: string; value: string; source: string }>;
  missingInputs: string[];
  /** Always false. Arithmetic over an ordinance is not an entitlement. */
  approvedYield: false;
  reason: string;
};

export type ZoningSubdivisionFacts = JsonObject & {
  lane: ZoningSubdivisionLane;
  executed: boolean;
  outcome: ZoningSubdivisionOutcome;
  subject: {
    propertyCardId: number | null;
    dealCardId: number | null;
    address: string | null;
    apn: string | null;
    county: string | null;
    state: string | null;
    acres: number | null;
  };
  jurisdiction: ZoningSubdivisionJurisdictionFacts;
  zoning: ZoningSubdivisionZoningFacts;
  rules: {
    count: number;
    documentCount: number;
    ordinanceLabel: string | null;
    ordinanceUrl: string | null;
    package: LandUseRuleFact[];
  };
  subdivisionByRight: SubdivisionByRightFacts;
  sources: ZoningSubdivisionSourceFact[];
  research: LandUseResearchOutcome | null;
  limitations: string[];
  summary: string;
};

/** The canonical subject this capability was handed, never one it chose. */
interface ZoningSubdivisionSubject {
  propertyCardId: number | null;
  dealCardId: number | null;
  address: string | null;
  apn: string | null;
  county: string | null;
  state: string | null;
  acres: number | null;
}

const str = (value: unknown): string | null => {
  const raw = typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';
  return raw && !/^(?:-|--|n\/?a|none|unknown)$/i.test(raw) ? raw : null;
};

const num = (value: unknown): number | null => {
  const text = typeof value === 'number' ? String(value) : String(value ?? '').trim();
  if (!text) return null;
  const parsed = Number(text.replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
};

const laneOf = (parameters: JsonObject | undefined): ZoningSubdivisionLane =>
  (typeof parameters?.lane === 'string' ? parameters.lane : '') === 'research' ? 'research' : 'retained_rules';

/** Trim a verbatim ordinance passage to something an operator surface can show. */
function passage(value: string | null | undefined, max = 320): string | null {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * The jurisdiction a rule package belongs to.
 *
 * Deliberately the same construction the accepted regulation store uses, so a
 * package this capability reports and the package the subdivision lane retains
 * are the same package rather than two keys for one government.
 */
function rulePackageJurisdiction(
  authority: ControllingLandUseAuthority | null,
  state: string | null,
): RegulationJurisdiction | null {
  const subdivisionAuthority = authority?.subdivisionAuthority ?? null;
  if (!subdivisionAuthority?.name || !state) return null;
  if (subdivisionAuthority.determination === 'unresolved' || subdivisionAuthority.determination === 'ambiguous') return null;
  return { authorityName: subdivisionAuthority.name, level: subdivisionAuthority.level, state };
}

const packageKeyOf = (jurisdiction: RegulationJurisdiction | null): string | null =>
  jurisdiction ? `${jurisdiction.state}:${jurisdiction.level}:${jurisdiction.authorityName}`.toLowerCase() : null;

/** Project one evidenced land-use value onto a rule row. */
function ruleFromEvidenced(
  key: string,
  label: string,
  value: EvidencedValue<string | boolean | number> | undefined,
  authorityName: string | null,
): LandUseRuleFact | null {
  if (!value) return null;
  const rendered = value.value == null
    ? null
    : typeof value.value === 'boolean' ? (value.value ? 'Yes' : 'No') : String(value.value);
  if (rendered == null && !value.unresolvedReason) return null;
  const citation = value.citations[0] ?? null;
  return {
    key,
    label,
    value: rendered,
    unresolved: rendered == null ? value.unresolvedReason ?? 'Not established.' : null,
    section: citation?.citation ?? null,
    sourceLabel: citation?.label ?? null,
    sourceUrl: citation?.url ?? null,
    authorityName,
    confidence: value.quality,
    scope: 'jurisdiction',
  };
}

/**
 * The jurisdiction's rule package.
 *
 * Assembled from BOTH accepted retained records — the nationwide engine's
 * subdivision framework and dimensional standards, and the post-resolution
 * subdivision-regulation retrieval — deduplicated by rule key. Neither is
 * re-derived; a rule that both carry is reported once, with the source that
 * stated it.
 */
function rulePackage(
  determination: LandUseDetermination | null,
  regulations: SubdivisionRegulations | null,
): LandUseRuleFact[] {
  const rules: LandUseRuleFact[] = [];
  const held = new Set<string>();
  const push = (rule: LandUseRuleFact | null): void => {
    if (!rule || held.has(rule.key)) return;
    held.add(rule.key);
    rules.push(rule);
  };

  // The retrieved regulations first: they are the government's own adopted
  // document, read section by section.
  for (const rule of regulations?.rules ?? []) {
    push({
      key: rule.key,
      label: rule.label,
      value: rule.value,
      unresolved: null,
      section: rule.section,
      sourceLabel: rule.sourceLabel,
      sourceUrl: rule.sourceUrl,
      authorityName: rule.authorityName ?? regulations?.authorityName ?? null,
      confidence: rule.confidence,
      scope: 'jurisdiction',
    });
  }

  const subdivision = determination?.subdivision;
  const authorityName = subdivision?.governingBody ?? null;
  if (subdivision) {
    push(ruleFromEvidenced('minimum_lot_size', 'Minimum lot size', subdivision.minimumLotArea, authorityName));
    push(ruleFromEvidenced('minimum_lot_width', 'Minimum lot width', subdivision.minimumLotWidth, authorityName));
    push(ruleFromEvidenced('minimum_road_frontage', 'Minimum road frontage', subdivision.minimumRoadFrontage, authorityName));
    push(ruleFromEvidenced('flag_lots', 'Flag lots', subdivision.flagLots, authorityName));
    push(ruleFromEvidenced('shared_driveways', 'Shared driveways', subdivision.sharedDriveways, authorityName));
    push(ruleFromEvidenced('private_roads', 'Private roads', subdivision.privateRoads, authorityName));
    push(ruleFromEvidenced('public_road_frontage_required', 'Public road frontage required', subdivision.publicRoadFrontageRequired, authorityName));
    push(ruleFromEvidenced('new_road_trigger', 'New road trigger', subdivision.newRoadTrigger, authorityName));
    push(ruleFromEvidenced('survey_requirement', 'Survey requirement', subdivision.surveyRequirement, authorityName));
    push(ruleFromEvidenced('plat_requirement', 'Plat requirement', subdivision.platRequirement, authorityName));
    push(ruleFromEvidenced('recording_requirement', 'Recording requirement', subdivision.recordingRequirement, authorityName));
    push(ruleFromEvidenced('utility_requirement', 'Utility requirement', subdivision.utilityRequirement, authorityName));
    push(ruleFromEvidenced('septic_requirement', 'Septic requirement', subdivision.septicRequirement, authorityName));
    push(ruleFromEvidenced('well_requirement', 'Well requirement', subdivision.wellRequirement, authorityName));
    push(ruleFromEvidenced('stormwater_requirement', 'Stormwater requirement', subdivision.stormwaterRequirement, authorityName));
    push(ruleFromEvidenced('fire_access_requirement', 'Fire access requirement', subdivision.fireAccessRequirement, authorityName));
    push(ruleFromEvidenced('published_review_timeline', 'Published review timeline', subdivision.publishedReviewTimeline, authorityName));
    push(ruleFromEvidenced('parent_tract_applies', 'Parent-tract rule applies', subdivision.parentTract.applies, authorityName));
    push(ruleFromEvidenced('parent_tract_lookback', 'Parent-tract lookback period', subdivision.parentTract.lookbackPeriod, authorityName));
    for (const path of subdivision.paths) {
      push(ruleFromEvidenced(
        `path_${path.kind}_maximum_lots`,
        `${path.originalTerm}: maximum lots`,
        path.maximumLots as EvidencedValue<number>,
        authorityName,
      ));
    }
  }

  // Dimensional standards are the zoning district's own numbers, and they gate
  // any resulting lot just as the subdivision standards do.
  for (const standard of determination?.dimensionalStandards ?? []) {
    push({
      key: `dimensional_${standard.kind}`,
      label: standard.originalTerm,
      value: standard.qualifier ? `${standard.statedValue} (${standard.qualifier})` : standard.statedValue,
      unresolved: null,
      section: standard.citation.citation,
      sourceLabel: standard.citation.label,
      sourceUrl: standard.citation.url,
      authorityName: determination?.zoning.governingAuthority ?? authorityName,
      confidence: 'confirmed',
      scope: 'jurisdiction',
    });
  }
  return rules;
}

/**
 * The materially relied-upon official sources, so the operator never has to
 * search for the document again.
 */
function sourceFacts(
  determination: LandUseDetermination | null,
  regulations: SubdivisionRegulations | null,
  zoning: CurrentZoningDetermination | null,
  authority: ControllingLandUseAuthority | null,
  jurisdictionLabel: string | null,
): ZoningSubdivisionSourceFact[] {
  const sources: ZoningSubdivisionSourceFact[] = [];
  const held = new Set<string>();
  const push = (source: ZoningSubdivisionSourceFact): void => {
    const key = source.url ?? `${source.sourceType}:${source.title}`;
    if (held.has(key)) return;
    held.add(key);
    sources.push(source);
  };

  for (const citation of (determination?.sources ?? []) as LegalSourceCitation[]) {
    push({
      title: citation.label,
      sourceType: citation.tier,
      url: citation.url,
      jurisdiction: citation.publisher ?? jurisdictionLabel,
      date: citation.effectiveDate,
      section: citation.citation,
      retrievedAt: citation.retrievedAt,
    });
  }
  for (const document of regulations?.documents ?? []) {
    push({
      title: document.draftOrProposed ? `${document.label} (DRAFT/PROPOSED)` : document.label,
      sourceType: 'subdivision_regulations',
      url: document.url,
      jurisdiction: regulations?.authorityName ?? jurisdictionLabel,
      date: document.adoptedOrAsOf,
      section: null,
      retrievedAt: document.retrievedAt,
    });
  }
  // The zoning source that was actually SELECTED leads; the candidates that
  // were considered and refused follow, so the operator can open what LandOS
  // looked at as well as what it relied on.
  if (zoning?.sourceUrl) {
    push({
      title: zoning.sourceLabel ?? 'Official zoning source',
      sourceType: zoning.evidenceKind ?? 'zoning_source',
      url: zoning.sourceUrl,
      jurisdiction: zoning.authorityName ?? jurisdictionLabel,
      date: zoning.effectiveOrAsOf,
      section: null,
      retrievedAt: zoning.verifiedAt,
    });
  }
  for (const considered of zoning?.consideredEvidence ?? []) {
    if (!considered.candidate.sourceUrl) continue;
    push({
      title: considered.candidate.sourceLabel,
      sourceType: considered.candidate.kind,
      url: considered.candidate.sourceUrl,
      jurisdiction: zoning?.authorityName ?? jurisdictionLabel,
      date: considered.candidate.effectiveOrAsOf,
      section: null,
      retrievedAt: considered.candidate.retrievedAt,
    });
  }
  for (const source of [...(authority?.zoningAuthority?.sources ?? []), ...(authority?.subdivisionAuthority?.sources ?? [])]) {
    if (!source.url) continue;
    push({
      title: source.label,
      sourceType: 'controlling_authority',
      url: source.url,
      jurisdiction: jurisdictionLabel,
      date: null,
      section: null,
      retrievedAt: null,
    });
  }
  return sources;
}

/**
 * The by-right result, applied deterministically.
 *
 * `computeLegalYield` already decided this from the rules and the parcel facts;
 * `buildPropertySubdivisionRead` already decided the path, the review body and
 * the arithmetic. This maps those two accepted outputs onto one operator
 * status and never chooses a lot count of its own.
 */
function subdivisionByRight(
  determination: LandUseDetermination | null,
  read: PropertySubdivisionRead | null,
): SubdivisionByRightFacts {
  const legal = determination?.legalYield ?? null;
  const path = read?.likelyPath.kind ?? legal?.path ?? null;
  const constraintsApplied = legal?.constraintsApplied ?? [];
  const missingInputs = [...(legal?.missingInputs ?? [])];
  for (const caveat of read?.theoreticalLotCount.caveats ?? []) {
    if (!missingInputs.includes(caveat)) missingInputs.push(caveat);
  }
  // The deterministic yield wins whenever it produced a number.
  //
  // `computeLegalYield` applies the ADOPTED by-right procedural lot cap
  // alongside the lot-area minimum and publishes the smaller of the two — as
  // `provisional` when a required input is still missing, which is exactly the
  // CONDITIONAL case below. The property subdivision read's ceiling is
  // area-and-frontage arithmetic only and knows nothing about that cap, so
  // preferring it here would replace an adopted 4-lot cap with a 100-lot
  // division. It is the fallback, never the override.
  const maximumLots = legal?.maximumLots
    ?? read?.obviousMaximumLotConstraint.value
    ?? read?.theoreticalLotCount.value
    ?? null;

  // A major subdivision is never a by-right path, so the by-right question has
  // a real answer here and it is "not on this path" — not an unresolved.
  const status: SubdivisionByRightStatus = path === 'major_subdivision'
    ? 'NOT_APPLICABLE'
    : legal?.status === 'established'
      ? 'SUPPORTED'
      : legal?.status === 'provisional'
        ? 'CONDITIONAL'
        : missingInputs.length
          ? 'INSUFFICIENT_INFORMATION'
          : 'UNRESOLVED';

  const reason = path === 'major_subdivision'
    ? `${read?.likelyPath.why ?? 'The established path is a major subdivision.'} A major subdivision is a discretionary review path, so no lot count is available by right.`
    : legal?.reason
      ?? read?.theoreticalLotCount.calculation
      ?? 'No land-use rules have been established for this parcel yet, so no by-right result was computed.';

  return {
    status,
    statusLabel: BY_RIGHT_STATUS_LABEL[status],
    // A lot count is reported only where the status supports one. Printing a
    // ceiling beside "insufficient information" is exactly how an unsupported
    // number becomes the number an operator remembers.
    maximumLots: status === 'SUPPORTED' || status === 'CONDITIONAL' ? maximumLots : null,
    path,
    reviewBody: read?.requiredReviewBody ?? determination?.subdivision.governingBody ?? null,
    reviewIndication: read?.reviewIndication ?? null,
    basis: read?.likelyPath.basis ?? (legal?.status ?? 'unknown'),
    calculation: read?.theoreticalLotCount.calculation ?? null,
    constraintsApplied,
    missingInputs,
    approvedYield: false,
    reason,
  };
}

function emptyFacts(
  lane: ZoningSubdivisionLane,
  subject: ZoningSubdivisionSubject,
  summary: string,
): ZoningSubdivisionFacts {
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
      acres: subject.acres,
    },
    jurisdiction: {
      county: subject.county,
      state: subject.state,
      municipality: null,
      incorporationStatus: null,
      authorityPattern: null,
      authorities: [],
      rulePackageKey: null,
      rulePackageReused: false,
      retainedJurisdictionDocuments: [],
    },
    zoning: {
      established: false,
      districtCode: null,
      districtName: null,
      presence: null,
      statement: 'No zoning district has been established for this parcel.',
      confidence: 'unresolved',
      governingAuthority: null,
      nonZoningClassification: null,
      historicalReferences: [],
      limitations: [],
    },
    rules: { count: 0, documentCount: 0, ordinanceLabel: null, ordinanceUrl: null, package: [] },
    subdivisionByRight: subdivisionByRight(null, null),
    sources: [],
    research: null,
    limitations: [],
    summary,
  };
}

/** Property Resolution owns raw input. This capability only consumes it. */
async function resolveRawSubject(
  request: CapabilityInvocationRequest,
  runtime: ZoningSubdivisionRuntime,
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
): ZoningSubdivisionSubject {
  return {
    propertyCardId: canonical?.propertyCardId ?? null,
    dealCardId: canonical?.dealCardId ?? null,
    address: str(identity.address),
    apn: str(identity.apn),
    county: str(identity.county),
    state: str(identity.state),
    acres: num(identity.acres),
  };
}

/** Read everything LandOS already retains for this parcel's land-use question. */
function retainedFacts(
  lane: ZoningSubdivisionLane,
  subject: ZoningSubdivisionSubject,
  runtime: ZoningSubdivisionRuntime,
  research: LandUseResearchOutcome | null,
): { facts: ZoningSubdivisionFacts; evidence: CapabilityEvidenceReference[]; missingInformation: string[] } {
  const dealCardId = subject.dealCardId as number;
  const record = (runtime.readDetermination ?? ((id: number) => {
    const row = getLandUseDetermination(id);
    return row ? { determination: row.determination, determinedAt: row.determinedAt } : null;
  }))(dealCardId);
  const determination = record?.determination ?? null;
  const authority = (runtime.readAuthority ?? readControllingAuthority)(dealCardId);
  const zoning = (runtime.readZoning ?? readCurrentZoning)(dealCardId);
  const regulations = (runtime.readRegulations ?? readSubdivisionRegulations)(dealCardId);
  const read = (runtime.readSubdivisionRead ?? readPropertySubdivisionRead)(dealCardId);

  const state = authority?.state ?? determination?.subject.state ?? subject.state;
  const county = authority?.county ?? determination?.subject.county ?? subject.county;
  const jurisdiction = rulePackageJurisdiction(authority, state);
  const retainedDocuments = jurisdiction
    ? (runtime.readJurisdictionDocuments ?? ((row: RegulationJurisdiction) =>
        readRegulationDocuments(row).map((document) => ({ url: document.url, label: document.label }))))(jurisdiction)
    : [];

  const authorities: ZoningSubdivisionAuthorityFact[] = [];
  const pushAuthority = (role: string, value: { name: string | null; level: string | null; determination: string; basis: string | null } | null | undefined): void => {
    if (!value) return;
    authorities.push({
      role,
      name: value.name ?? null,
      level: value.level ?? null,
      determination: value.determination,
      basis: passage(value.basis, 400),
      officialUrl: null,
    });
  };
  pushAuthority('Zoning', authority?.zoningAuthority);
  pushAuthority('Subdivision', authority?.subdivisionAuthority);
  if (!authorities.length && determination) {
    for (const [role, resolved] of [
      ['Zoning', determination.authority.zoningAuthority],
      ['Subdivision', determination.authority.subdivisionAuthority],
    ] as const) {
      authorities.push({
        role,
        name: resolved.name.value,
        level: resolved.unitType,
        determination: resolved.name.value ? resolved.name.quality : 'unresolved',
        basis: passage(resolved.relationship, 400),
        officialUrl: resolved.officialUrl,
      });
    }
  }

  // The current district, and every historical or requested district kept
  // beside it and labelled so it can never be read as the district in force.
  const established = zoning?.established ?? (determination?.zoning.code.value != null && determination.zoning.classificationKind === 'adopted_zoning');
  const districtCode = zoning?.districtCode ?? determination?.zoning.code.value ?? null;
  const zoningFacts: ZoningSubdivisionZoningFacts = {
    established: Boolean(established),
    districtCode: established ? districtCode : null,
    districtName: zoning?.districtName ?? determination?.zoning.districtName.value ?? null,
    presence: determination?.zoning.presence ?? null,
    statement: established && districtCode
      ? `The parcel is in district ${districtCode}${zoning?.districtName ? ` (${zoning.districtName})` : ''}${zoning?.authorityName ? `, administered by ${zoning.authorityName}` : ''}.`
      : zoning?.limitations[0]
        ?? determination?.zoning.code.unresolvedReason
        ?? 'No zoning district has been established for this parcel.',
    confidence: zoning?.confidence ?? determination?.zoning.code.quality ?? 'unresolved',
    governingAuthority: zoning?.authorityName ?? determination?.zoning.governingAuthority ?? null,
    nonZoningClassification: determination?.zoning.nonZoningClassification
      ? {
          code: determination.zoning.nonZoningClassification.code,
          description: determination.zoning.nonZoningClassification.description,
          sourceUrl: determination.zoning.nonZoningClassification.sourceUrl,
        }
      : null,
    historicalReferences: (zoning?.historicalReferences ?? []).map((row) => ({
      kind: row.kind,
      value: row.value,
      asOf: row.asOf,
      sourceUrl: row.sourceUrl,
      neverEstablishesCurrentZoning: true as const,
    })),
    limitations: zoning?.limitations ?? [],
  };

  const rules = rulePackage(determination, regulations);
  const jurisdictionLabel = [authority?.municipality ?? null, county, state].filter(Boolean).join(', ') || null;
  const sources = sourceFacts(determination, regulations, zoning, authority, jurisdictionLabel);
  const byRight = subdivisionByRight(determination, read);

  const limitations = [
    ...(determination?.unresolved ?? []),
    ...(regulations?.limitations ?? []),
    ...(read?.limitations ?? []),
  ].filter((row, index, all) => row && all.indexOf(row) === index);

  const missingInformation: string[] = [];
  if (!rules.length) missingInformation.push('An authoritative zoning or subdivision rule source for this jurisdiction');
  if (!zoningFacts.established) {
    missingInformation.push(zoningFacts.statement || 'The adopted zoning district for this parcel');
  }
  for (const input of byRight.missingInputs) missingInformation.push(input);
  for (const step of read?.nextAuthoritativeDiligence ?? []) missingInformation.push(step);

  const evidence: CapabilityEvidenceReference[] = sources
    .filter((source) => source.url)
    .map((source) => ({
      source: source.title,
      sourceUrl: source.url,
      sourceType: source.sourceType,
      retrievedAt: source.retrievedAt ?? record?.determinedAt ?? new Date().toISOString(),
      details: {
        jurisdiction: source.jurisdiction,
        section: source.section,
        date: source.date,
      },
    }));

  const anythingRetained = Boolean(determination || authority || zoning || regulations || read);
  const summary = anythingRetained
    ? `${zoningFacts.established && zoningFacts.districtCode ? `Zoning ${zoningFacts.districtCode}` : 'Zoning not established'}; ${rules.length} jurisdiction rule(s) retained from ${sources.length} official source(s); ${byRight.statusLabel.toLowerCase()}${byRight.maximumLots != null ? ` at up to ${byRight.maximumLots} lot(s)` : ''}.`
    : 'LandOS retains no land-use rules for this parcel yet.';

  const facts: ZoningSubdivisionFacts = {
    ...emptyFacts(lane, subject, summary),
    executed: true,
    outcome: rules.length ? 'rules_returned' : anythingRetained ? 'retained_only' : 'not_available',
    jurisdiction: {
      county,
      state,
      municipality: authority?.municipality ?? null,
      incorporationStatus: authority?.incorporationStatus ?? null,
      authorityPattern: determination?.authority.pattern ?? null,
      authorities,
      rulePackageKey: packageKeyOf(jurisdiction),
      // The package is reused when this government's retained document set
      // already carried the documents this parcel's rules came from.
      rulePackageReused: retainedDocuments.length > 0,
      retainedJurisdictionDocuments: retainedDocuments,
    },
    zoning: zoningFacts,
    rules: {
      count: rules.length,
      documentCount: regulations?.documents.length ?? 0,
      ordinanceLabel: determination?.subdivision.ordinanceLabel ?? regulations?.documents[0]?.label ?? null,
      ordinanceUrl: determination?.subdivision.ordinanceUrl ?? regulations?.documents[0]?.url ?? null,
      package: rules,
    },
    subdivisionByRight: byRight,
    sources,
    research,
    limitations,
  };

  return { facts, evidence, missingInformation: [...new Set(missingInformation)] };
}

export const ZONING_SUBDIVISION_CAPABILITY: LandosCapability<ZoningSubdivisionFacts, ZoningSubdivisionRuntime> = {
  metadata: {
    id: ZONING_SUBDIVISION_CAPABILITY_ID,
    name: 'Zoning & Subdivision',
    contractVersion: '1.0',
    description: 'Answers what rules apply to the canonical property because of where it is: the controlling jurisdiction, the adopted zoning district, the jurisdiction-scoped zoning and subdivision rule package with its official sources, and the deterministically applied subdivision-by-right result with its missing inputs stated honestly.',
  },
  validate(request: CapabilityInvocationRequest): void {
    const allowed = new Set(['lane', 'runId']);
    const unsupported = Object.keys(request.parameters ?? {}).filter((key) => !allowed.has(key));
    if (unsupported.length) {
      throw new Error(`Zoning & Subdivision does not accept caller-supplied ${unsupported.join(', ')}; land-use facts come from the official evidence, not the caller`);
    }
    const lane = request.parameters?.lane;
    if (lane != null && !['retained_rules', 'research'].includes(String(lane))) {
      throw new Error(`unknown Zoning & Subdivision lane ${String(lane)}`);
    }
    const reserved = /^(?:zoning|zoningDistrict|district|ordinance|minimumLotSize|frontage|density|maximumLots|subdivision|subdivisionByRight|rules|facts|evidence)$/i;
    const asserts = (value: unknown): boolean => {
      if (Array.isArray(value)) return value.some(asserts);
      if (!value || typeof value !== 'object') return false;
      return Object.entries(value as Record<string, unknown>)
        .some(([key, child]) => reserved.test(key) || asserts(child));
    };
    if (asserts(request.context ?? {})) {
      throw new Error('Zoning & Subdivision context cannot contain caller-supplied zoning or subdivision assertions');
    }
  },
  async execute(
    request: CapabilityInvocationRequest,
    runtime: ZoningSubdivisionRuntime,
    _environment: CapabilityExecutionEnvironment,
  ): Promise<CapabilityExecutionOutcome<ZoningSubdivisionFacts>> {
    const lane = laneOf(request.parameters);
    const warnings: string[] = [];
    let subject: ZoningSubdivisionSubject;
    let canonicalSubject: CanonicalSubjectReference | null;
    let subjectResolution: SubjectResolutionState;
    let resolutionEvidence: CapabilityEvidenceReference[] = [];

    if (request.subject.kind === 'canonical_property') {
      // The Deal Card and New Lead path. The subject already exists; reading it
      // is the whole identity step, and nothing here may change it.
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
        acres: retainedSubject.acres ?? null,
      };
      canonicalSubject = { kind: 'property', id: String(propertyCardId), propertyCardId, dealCardId, temporary: false };
      const evaluation = evaluateResolverIdentity(retainedSubject);
      subjectResolution = evaluation.sufficient ? 'RESOLVED' : 'UNRESOLVED';
      if (!evaluation.sufficient) warnings.push(...evaluation.conflicts);
    } else {
      // Tools. Raw operator input is resolved by the Property Resolution
      // Capability; this capability consumes whatever subject that returns and
      // creates nothing of its own — no Property Card, no Deal Card, no lead.
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
            'No land-use research ran: Property Resolution has not established one canonical parcel for this input.'),
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
      // A Tools run on a subject LandOS holds no Deal Card for has no retained
      // land-use record to read, and this capability creates neither a Deal
      // Card nor a lead to manufacture one.
      warnings.push('This subject has no canonical Deal Card, so LandOS retains no land-use rules for it yet. Nothing was created.');
      return {
        status: 'NEEDS_INPUT',
        subjectResolution,
        canonicalSubject,
        facts: emptyFacts(lane, subject,
          'No land-use rules are retained for this subject: it is not a canonical LandOS property yet, and a research run creates no lead.'),
        evidence: resolutionEvidence,
        warnings,
        missingInformation: ['Retained land-use rules for this subject, which a canonical Deal Card carries'],
      };
    }

    // ── The live land-use research lane ──────────────────────────────────────
    //
    // Web search is a first-class discovery tool here: when the jurisdiction's
    // rules are not already trusted, this lane searches early to LOCATE the
    // authoritative government source, then reads that source. The transports
    // live in the route layer, so a caller that cannot reach them still gets
    // the retained answer rather than an error.
    let research: LandUseResearchOutcome | null = null;
    if (lane === 'research') {
      if (!runtime.runLandUseResearch || subject.propertyCardId == null) {
        warnings.push('The live land-use research lane is not available in this environment.');
      } else {
        research = await runtime.runLandUseResearch({
          propertyCardId: subject.propertyCardId,
          dealCardId: subject.dealCardId,
        });
      }
    }

    const projected = retainedFacts(lane, subject, runtime, research);
    const facts: ZoningSubdivisionFacts = research
      ? { ...projected.facts, outcome: projected.facts.outcome === 'not_available' ? 'lane_completed' : projected.facts.outcome }
      : projected.facts;

    return {
      status: facts.outcome === 'rules_returned' ? 'SUCCEEDED' : 'NEEDS_INPUT',
      subjectResolution,
      canonicalSubject,
      facts,
      evidence: [...resolutionEvidence, ...projected.evidence],
      warnings,
      missingInformation: projected.missingInformation,
    };
  },
};
