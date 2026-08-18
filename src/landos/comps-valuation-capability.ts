// LandOS — Comps & Valuation Capability.
//
// This is a PLACEMENT, not a new comp engine and not a new valuation method.
// Every comparable LandOS already collects, every classification it already
// applies, and every value it already concludes stays exactly where it is; this
// module is the runtime Capability envelope around that existing accepted
// implementation, so Tools, New Lead and the V2 Deal Card reach ONE comping and
// valuation implementation through one contract.
//
// The three existing execution paths it wraps, all reused verbatim:
//
//   1. `buildCompsValuationView()` — the canonical operator-facing Comps &
//      Valuation projection for a Deal Card. It is what already carries the
//      classified comp set, the acreage band and recency window that selected
//      it, the cleaned FMV reconciliation, the adopted land value, the house
//      value overlay, and the whole-property figure. It is a SELECT: it reads
//      what the card retains and computes nothing new about the property.
//   2. The live comparable-collection lane (`collectComparables` behind the
//      mission's `comparables` collector). The provider browsers and the
//      marketplace transports live in the route layer, so that executor is
//      INJECTED rather than imported — the capability owns the invocation, not
//      the browser.
//   3. `computeMissionCompValuation()` — New Lead's comp-source-policy →
//      working-set → valuation computation, also injected. It is the mission's
//      own existing implementation; the capability executes it and never
//      re-derives a valuation beside it.
//
// Hard rules carried over from the underlying implementation:
//   - The canonical subject comes from Property Resolution. This capability
//     never decides that a different parcel is the subject; on raw input it
//     delegates to the Property Resolution Capability and consumes what that
//     returns. A rerun re-reads the same canonical subject; it can never
//     silently repoint the property.
//   - Existing valuation rules are unchanged. Land remains the primary basis,
//     the structure figure is the House Value, and the separate Land Value /
//     House Value / Whole Property Value split is reported ONLY when the
//     subject is more than one acre. At an acre or less LandOS reports one
//     property value rather than three components.
//   - Weak evidence stays weak. A subject with no usable comps returns an
//     honest "not established" with the reason; no valuation is fabricated to
//     make the result look complete.
//   - Provenance travels with the comp. Every projected record keeps the
//     provider, the source URL and the classification that put it there.
//
// Not in scope, and deliberately so: the comp-selection algorithm, the acreage
// band, the recency window, the cleaned-FMV method, the house-value overlay and
// the provider set. Those are the accepted implementation this capability is a
// door onto.

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
import { buildCompsValuationView, type CompsValuationView, type WorkspaceComp } from './comps-valuation.js';
import { getDealCardIdForPropertyCard } from './deal-card.js';
import { PROPERTY_RESOLUTION_CAPABILITY_ID } from './property-resolution-capability.js';
import { evaluateResolverIdentity, readResolverSubject } from './universal-property-resolution.js';

export const COMPS_VALUATION_CAPABILITY_ID = 'comps-valuation';

/**
 * The three existing execution paths, named.
 *
 * `retained_valuation` is the default because it is the one path that answers
 * for every caller: it needs no browser, consumes no provider credit, and works
 * the same for a Tools one-off and a Deal Card rerun.
 */
export type CompsValuationLane = 'retained_valuation' | 'comp_collection' | 'mission_valuation';

export type CompsValuationOutcome =
  | 'valuation_returned'
  | 'lane_completed'
  | 'retained_only'
  | 'not_available';

/** What the injected live comparable-collection lane reports back. */
export type CompCollectionOutcome = {
  candidateCount: number;
  duplicatesMerged: number;
  sources: string[];
  summary: string;
  sourceAttempts: Array<{ source: string; status: string; note: string }>;
};

/** The compact honest projection of a New Lead valuation-lane run. */
export type MissionValuationOutcome = {
  priceable: boolean;
  rangeLow: number | null;
  rangeHigh: number | null;
  confidence: string | null;
  notPriceableReason: string | null;
  acceptedSoldCount: number;
  activeListingCount: number;
  landHomeCompCount: number;
  summary: string;
};

export interface CompsValuationRuntime {
  /**
   * Raw operator input is resolved by the Property Resolution Capability, never
   * here. The registry injects the real invoker; tests inject a stub.
   */
  resolveSubject?: (request: CapabilityInvocationRequest) => Promise<CapabilityResult>;
  /** The existing canonical Comps & Valuation projection. Tests override it. */
  loadCompsValuation?: (dealCardId: number) => CompsValuationView | null;
  /** The existing live comparable-collection lane, owned by the route layer. */
  runCompCollection?: (input: { propertyCardId: number; dealCardId: number }) => Promise<CompCollectionOutcome>;
  /** The existing New Lead valuation computation, owned by the route layer. */
  runMissionValuation?: (input: { propertyCardId: number; dealCardId: number }) => Promise<MissionValuationOutcome>;
}

/** One comparable, as the existing projection classified it. */
export type CompsValuationCompFact = {
  key: string;
  compId: number | null;
  address: string | null;
  apn: string | null;
  county: string | null;
  state: string | null;
  category: string;
  categoryLabel: string;
  source: string;
  sourceUrl: string | null;
  origins: string[];
  priceKind: 'sale' | 'list' | 'unknown';
  price: number | null;
  acres: number | null;
  pricePerAcre: number | null;
  dateIso: string | null;
  daysOnMarket: number | null;
  distanceMiles: number | null;
  propertyClass: 'land' | 'improved' | 'unknown';
  buildingSqft: number | null;
  inValuationSet: boolean;
  valuationRole: string | null;
  valuationWeight: number | null;
  operatorExcluded: boolean;
  exclusionReason: string | null;
  classificationReason: string;
  locationResolved: boolean;
  missingFields: string[];
};

/**
 * The land value, and the components the existing overlay produces beside it.
 *
 * `split.applies` carries the accepted acreage rule rather than leaving each
 * surface to reinvent it: the separate Land Value / House Value / Whole
 * Property Value components are reported only for a subject of MORE than one
 * acre. At an acre or less LandOS states one property value, and `why` says so
 * in the operator's terms.
 */
export type CompsValuationSplitFacts = {
  applies: boolean;
  why: string;
  landValue: number | null;
  houseValue: number | null;
  wholePropertyValue: number | null;
};

export type CompsValuationValueFacts = {
  status: string;
  statusLabel: string;
  basisLabel: string;
  statusReason: string;
  confidence: string;
  confidenceFactors: string[];
  /** The adopted land value — the LandOS decision number for the parcel. */
  landValue: number | null;
  medianPricePerAcre: number | null;
  weightedPricePerAcre: number | null;
  retailRangeLow: number | null;
  retailRangeHigh: number | null;
  acquisitionLevels: { pct40: number; pct50: number; pct60: number } | null;
  acquisitionLockedReason: string | null;
  workingAcres: number | null;
  valuationSetCount: number;
  directCount: number;
  supportingCount: number;
  excludedCount: number;
  windowLabel: string | null;
};

export type CompsValuationSubjectFacts = {
  propertyCardId: number | null;
  dealCardId: number | null;
  address: string | null;
  apn: string | null;
  county: string | null;
  state: string | null;
  acres: number | null;
  improved: boolean;
  improvementType: string | null;
  buildingSqft: number | null;
  valuationScope: string | null;
  valuationScopeLabel: string | null;
};

export type CompsValuationFacts = JsonObject & {
  lane: CompsValuationLane;
  executed: boolean;
  outcome: CompsValuationOutcome;
  subject: CompsValuationSubjectFacts;
  valuation: CompsValuationValueFacts | null;
  split: CompsValuationSplitFacts;
  comps: {
    canonicalCount: number;
    retainedTotal: number;
    duplicatesMerged: number;
    valuationSetCount: number;
    activeCount: number;
    mapped: number;
    unresolvedLocations: number;
    selected: CompsValuationCompFact[];
  };
  collection: CompCollectionOutcome | null;
  missionValuation: MissionValuationOutcome | null;
  sourceAttempts: Array<{ source: string; status: string; note: string }>;
  summary: string;
};

/** The canonical subject this capability was handed, never one it chose. */
interface CompsValuationSubject {
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

const laneOf = (parameters: JsonObject | undefined): CompsValuationLane => {
  const raw = typeof parameters?.lane === 'string' ? parameters.lane : 'retained_valuation';
  return raw === 'comp_collection' || raw === 'mission_valuation' ? raw : 'retained_valuation';
};

const money = (value: number | null): string =>
  value == null ? 'not established' : `$${Math.round(value).toLocaleString('en-US')}`;

/**
 * The accepted acreage rule for the valuation components.
 *
 * Land is the primary investment focus, so a parcel of more than one acre is
 * reported as Land Value plus House Value plus Whole Property Value. At an acre
 * or less those three components are not split out; the subject carries one
 * property value. Unknown acreage is not a split either — the rule turns on a
 * known acreage, and inventing one would decide the presentation on a guess.
 */
function splitFacts(
  acres: number | null,
  landValue: number | null,
  houseValue: number | null,
  wholePropertyValue: number | null,
): CompsValuationSplitFacts {
  if (acres == null) {
    return {
      applies: false,
      why: 'Subject acreage is not established, so the Land Value / House Value / Whole Property Value split is not reported. One value is carried until the acreage is known.',
      landValue,
      houseValue: null,
      wholePropertyValue: null,
    };
  }
  if (acres > 1) {
    return {
      applies: true,
      why: `The subject is ${acres} acres, more than one acre, so the land and the structure are reported separately: Land Value ${money(landValue)}, House Value ${money(houseValue)}, Whole Property Value ${money(wholePropertyValue)}.`,
      landValue,
      houseValue,
      wholePropertyValue,
    };
  }
  return {
    applies: false,
    why: `The subject is ${acres} acres, one acre or less, so LandOS reports one property value rather than splitting it into Land Value, House Value and Whole Property Value.`,
    landValue,
    houseValue: null,
    wholePropertyValue: null,
  };
}

function compFact(comp: WorkspaceComp): CompsValuationCompFact {
  return {
    key: comp.key,
    compId: comp.compId,
    address: comp.address,
    apn: comp.apn,
    county: comp.county,
    state: comp.state,
    category: comp.category,
    categoryLabel: comp.categoryLabel,
    source: comp.source,
    sourceUrl: comp.sourceUrl,
    origins: comp.origins,
    priceKind: comp.priceKind,
    price: comp.price,
    acres: comp.acres,
    pricePerAcre: comp.pricePerAcre,
    dateIso: comp.dateIso,
    daysOnMarket: comp.daysOnMarket,
    distanceMiles: comp.distanceMiles,
    propertyClass: comp.propertyClass,
    buildingSqft: comp.buildingSqft,
    inValuationSet: comp.inValuationSet,
    valuationRole: comp.valuationRole,
    valuationWeight: comp.valuationWeight,
    operatorExcluded: comp.operatorExcluded,
    exclusionReason: comp.exclusionReason,
    classificationReason: comp.classificationReason,
    locationResolved: comp.locationResolved,
    missingFields: comp.missingFields,
  };
}

function emptyFacts(
  lane: CompsValuationLane,
  subject: CompsValuationSubject,
  summary: string,
): CompsValuationFacts {
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
      improved: false,
      improvementType: null,
      buildingSqft: null,
      valuationScope: null,
      valuationScopeLabel: null,
    },
    valuation: null,
    split: splitFacts(subject.acres, null, null, null),
    comps: {
      canonicalCount: 0,
      retainedTotal: 0,
      duplicatesMerged: 0,
      valuationSetCount: 0,
      activeCount: 0,
      mapped: 0,
      unresolvedLocations: 0,
      selected: [],
    },
    collection: null,
    missionValuation: null,
    sourceAttempts: [],
    summary,
  };
}

/** Property Resolution owns raw input. This capability only consumes it. */
async function resolveRawSubject(
  request: CapabilityInvocationRequest,
  runtime: CompsValuationRuntime,
): Promise<CapabilityResult> {
  if (runtime.resolveSubject) return runtime.resolveSubject(request);
  const { invokeRuntimeCapability } = await import('./capability-registry.js');
  return invokeRuntimeCapability({
    capabilityId: PROPERTY_RESOLUTION_CAPABILITY_ID,
    caller: request.caller,
    subject: request.subject,
    mode: request.mode ?? 'reuse',
    // The envelope is forwarded verbatim so a resolution the same caller has
    // already run for this input is reused rather than resolved twice.
    context: request.context ?? {},
  });
}

function subjectFromCanonicalIdentity(
  identity: Record<string, unknown>,
  canonical: CanonicalSubjectReference | null,
): CompsValuationSubject {
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

/**
 * Project the existing canonical Comps & Valuation view onto capability facts.
 *
 * Nothing here recomputes a value: every number is read out of the view the
 * accepted implementation already produced for this Deal Card.
 */
function factsFromView(
  lane: CompsValuationLane,
  subject: CompsValuationSubject,
  view: CompsValuationView,
): { facts: CompsValuationFacts; evidence: CapabilityEvidenceReference[]; missingInformation: string[] } {
  const cleaned = view.cleaned;
  const improvement = view.improvementValuation;
  const landValue = cleaned.adoptedFmv ?? view.summary.fmv?.central ?? null;
  const acres = view.subject.acres ?? subject.acres;
  const split = splitFacts(acres, landValue, improvement.estimatedSubjectImprovementValue, improvement.wholePropertyValue);
  const selected = view.comps.filter((comp) => comp.inValuationSet || comp.category === 'active_competition');
  const activeCount = view.comps.filter((comp) => comp.category === 'active_competition').length;
  const now = new Date().toISOString();

  const evidence: CapabilityEvidenceReference[] = selected
    .filter((comp) => comp.sourceUrl || comp.source)
    .map((comp) => ({
      source: comp.source,
      sourceUrl: comp.sourceUrl,
      sourceType: comp.inValuationSet ? 'valuation_comparable' : 'active_competition',
      retrievedAt: comp.dateIso ?? now,
      details: {
        address: comp.address,
        apn: comp.apn,
        acres: comp.acres,
        price: comp.price,
        priceKind: comp.priceKind,
        pricePerAcre: comp.pricePerAcre,
        valuationRole: comp.valuationRole,
        valuationWeight: comp.valuationWeight,
        distanceMiles: comp.distanceMiles,
      },
    }));

  const missingInformation: string[] = [];
  if (landValue == null) missingInformation.push('An adopted land value from the retained closed-sale evidence');
  if (!cleaned.cleanedCount) missingInformation.push('At least one qualifying closed vacant-land sale for this subject');
  if (cleaned.insufficiencyWarning) missingInformation.push(cleaned.insufficiencyWarning);
  if (split.applies && improvement.estimatedSubjectImprovementValue == null) {
    missingInformation.push(improvement.overlaySkippedReason
      ?? 'A qualifying house value for the subject improvements');
  }
  if (view.mapCounts.unresolved) {
    missingInformation.push(`${view.mapCounts.unresolved} retained comparable location(s) remain unresolved and are left honestly unplaced`);
  }

  const valuation: CompsValuationValueFacts = {
    status: view.summary.status,
    statusLabel: view.summary.statusLabel,
    basisLabel: view.summary.basisLabel,
    statusReason: view.summary.statusReason,
    confidence: cleaned.adoptedFmv != null ? cleaned.confidence : view.summary.confidence,
    confidenceFactors: view.summary.confidenceFactors,
    landValue,
    medianPricePerAcre: view.summary.medianPricePerAcre,
    weightedPricePerAcre: cleaned.weightedPpa,
    retailRangeLow: cleaned.retailRangeLow,
    retailRangeHigh: cleaned.retailRangeHigh,
    acquisitionLevels: view.summary.acquisitionLevels,
    acquisitionLockedReason: view.summary.acquisitionLockedReason,
    workingAcres: view.summary.workingAcres,
    valuationSetCount: cleaned.cleanedCount,
    directCount: cleaned.directCount,
    supportingCount: cleaned.supportingCount,
    excludedCount: cleaned.excludedCount,
    windowLabel: view.valuationWindow
      ? `${view.valuationWindow.selectedMonths}-month sale window to ${view.valuationWindow.cutoffIso}${view.valuationWindow.acreageBand ? `, ${view.valuationWindow.acreageBand.label} acreage band` : ''}`
      : null,
  };

  const summary = landValue != null
    ? `${view.summary.statusLabel}: land value ${money(landValue)} from ${cleaned.cleanedCount} qualifying closed sale(s) (${cleaned.directCount} direct), ${activeCount} active competitor(s) retained. ${split.why}`
    : `No land value is established for this subject: ${view.summary.statusReason}`;

  const facts: CompsValuationFacts = {
    ...emptyFacts(lane, subject, summary),
    executed: true,
    outcome: landValue != null
      ? 'valuation_returned'
      : view.comps.length ? 'retained_only' : 'not_available',
    subject: {
      propertyCardId: view.propertyCardId ?? subject.propertyCardId,
      dealCardId: view.dealCardId,
      address: view.subject.address ?? subject.address,
      apn: view.subject.apn ?? subject.apn,
      county: view.subject.county ?? subject.county,
      state: view.subject.state ?? subject.state,
      acres,
      improved: view.subjectImprovement.improved,
      improvementType: view.subjectImprovement.type,
      buildingSqft: view.subjectImprovement.buildingSqft,
      valuationScope: view.subjectImprovement.valuationScope,
      valuationScopeLabel: view.subjectImprovement.valuationScopeLabel,
    },
    valuation,
    split,
    comps: {
      canonicalCount: view.canonicalCompCount,
      retainedTotal: view.counts.total,
      duplicatesMerged: view.duplicatesMerged,
      valuationSetCount: cleaned.cleanedCount,
      activeCount,
      mapped: view.mapCounts.mapped,
      unresolvedLocations: view.mapCounts.unresolved,
      selected: selected.map(compFact),
    },
    // Which providers actually carried this subject's retained evidence, read
    // off the records themselves so a provider can never be credited without a
    // record behind it.
    sourceAttempts: [...new Set(view.comps.flatMap((comp) => [comp.source, ...comp.origins]).filter(Boolean))]
      .map((provider) => {
        const carried = view.comps.filter((comp) => comp.source === provider || comp.origins.includes(provider));
        const priced = carried.filter((comp) => comp.inValuationSet).length;
        return {
          source: provider,
          status: priced ? 'used' : 'retained',
          note: `${carried.length} retained record(s), ${priced} in the valuation set.`,
        };
      }),
  };

  return { facts, evidence, missingInformation };
}

export const COMPS_VALUATION_CAPABILITY: LandosCapability<CompsValuationFacts, CompsValuationRuntime> = {
  metadata: {
    id: COMPS_VALUATION_CAPABILITY_ID,
    name: 'Comps & Valuation',
    contractVersion: '1.0',
    description: 'Runs LandOS comparable-sales and valuation work for the canonical property subject: the classified comparable set with its provenance, the acreage band and recency window that selected it, the adopted land value and acquisition levels, and — for a subject over one acre — the House Value and Whole Property Value beside it.',
  },
  validate(request: CapabilityInvocationRequest): void {
    const allowed = new Set(['lane', 'runId']);
    const unsupported = Object.keys(request.parameters ?? {}).filter((key) => !allowed.has(key));
    if (unsupported.length) {
      throw new Error(`Comps & Valuation does not accept caller-supplied ${unsupported.join(', ')}; comparable and valuation facts come from the evidence, not the caller`);
    }
    const lane = request.parameters?.lane;
    if (lane != null && !['retained_valuation', 'comp_collection', 'mission_valuation'].includes(String(lane))) {
      throw new Error(`unknown Comps & Valuation lane ${String(lane)}`);
    }
    const reserved = /^(?:comps?|comparables?|valuation|fmv|landValue|houseValue|wholePropertyValue|pricePerAcre|acquisitionLevels|confidence|facts|evidence)$/i;
    const asserts = (value: unknown): boolean => {
      if (Array.isArray(value)) return value.some(asserts);
      if (!value || typeof value !== 'object') return false;
      return Object.entries(value as Record<string, unknown>)
        .some(([key, child]) => reserved.test(key) || asserts(child));
    };
    if (asserts(request.context ?? {})) {
      throw new Error('Comps & Valuation context cannot contain caller-supplied comparable or valuation assertions');
    }
  },
  async execute(
    request: CapabilityInvocationRequest,
    runtime: CompsValuationRuntime,
    _environment: CapabilityExecutionEnvironment,
  ): Promise<CapabilityExecutionOutcome<CompsValuationFacts>> {
    const lane = laneOf(request.parameters);
    const warnings: string[] = [];
    let subject: CompsValuationSubject;
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
            'No comping or valuation ran: Property Resolution has not established one canonical parcel for this input.'),
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

    // ── The live comparable-collection lane ──────────────────────────────────
    if (lane === 'comp_collection') {
      if (!runtime.runCompCollection || subject.propertyCardId == null || subject.dealCardId == null) {
        warnings.push('The live comparable-collection lane is not available in this environment.');
        return {
          status: 'NEEDS_INPUT',
          subjectResolution,
          canonicalSubject,
          facts: emptyFacts(lane, subject,
            'The live comparable-collection lane was not available for this subject.'),
          evidence: resolutionEvidence,
          warnings,
          missingInformation: ['A canonical Deal Card subject and the live comparable providers'],
        };
      }
      const collection = await runtime.runCompCollection({
        propertyCardId: subject.propertyCardId,
        dealCardId: subject.dealCardId,
      });
      const facts: CompsValuationFacts = {
        ...emptyFacts(lane, subject, collection.summary),
        executed: true,
        outcome: collection.candidateCount > 0 ? 'lane_completed' : 'not_available',
        collection,
        sourceAttempts: collection.sourceAttempts,
      };
      return {
        status: collection.candidateCount > 0 ? 'SUCCEEDED' : 'NEEDS_INPUT',
        subjectResolution,
        canonicalSubject,
        facts,
        evidence: resolutionEvidence,
        warnings,
        missingInformation: collection.candidateCount > 0
          ? []
          : ['At least one comparable candidate from an approved marketplace'],
      };
    }

    // ── The New Lead valuation lane ──────────────────────────────────────────
    if (lane === 'mission_valuation') {
      if (!runtime.runMissionValuation || subject.propertyCardId == null || subject.dealCardId == null) {
        warnings.push('The New Lead valuation computation is not available in this environment.');
        return {
          status: 'NEEDS_INPUT',
          subjectResolution,
          canonicalSubject,
          facts: emptyFacts(lane, subject,
            'The New Lead valuation computation was not available for this subject.'),
          evidence: resolutionEvidence,
          warnings,
          missingInformation: ['A canonical Deal Card subject with a completed comparable lane'],
        };
      }
      const missionValuation = await runtime.runMissionValuation({
        propertyCardId: subject.propertyCardId,
        dealCardId: subject.dealCardId,
      });
      const facts: CompsValuationFacts = {
        ...emptyFacts(lane, subject, missionValuation.summary),
        executed: true,
        outcome: missionValuation.priceable ? 'lane_completed' : 'not_available',
        missionValuation,
      };
      return {
        // A stated, defensible "not priceable" is a real valuation answer, and
        // the reason travels with it rather than being reported as a success.
        status: missionValuation.priceable ? 'SUCCEEDED' : 'NEEDS_INPUT',
        subjectResolution,
        canonicalSubject,
        facts,
        evidence: resolutionEvidence,
        warnings,
        missingInformation: missionValuation.priceable
          ? []
          : [missionValuation.notPriceableReason ?? 'Usable closed-sale evidence for this subject'],
      };
    }

    // ── The canonical retained projection (default) ───────────────────────────
    if (subject.dealCardId == null) {
      // A Tools run on a subject LandOS holds no Deal Card for has no retained
      // comparable evidence to read, and this capability creates neither a
      // Deal Card nor a lead to manufacture some.
      warnings.push('This subject has no canonical Deal Card, so LandOS retains no comparable evidence for it yet. Nothing was created.');
      return {
        status: 'NEEDS_INPUT',
        subjectResolution,
        canonicalSubject,
        facts: emptyFacts(lane, subject,
          'No comparable evidence is retained for this subject: it is not a canonical LandOS property yet, and a research run creates no lead.'),
        evidence: resolutionEvidence,
        warnings,
        missingInformation: ['Retained comparable evidence for this subject, which a canonical Deal Card carries'],
      };
    }

    const view = (runtime.loadCompsValuation ?? buildCompsValuationView)(subject.dealCardId);
    if (!view) {
      warnings.push(`Deal Card ${subject.dealCardId} has no Comps & Valuation projection.`);
      return {
        status: 'NEEDS_INPUT',
        subjectResolution,
        canonicalSubject,
        facts: emptyFacts(lane, subject,
          'The canonical Comps & Valuation projection is unavailable for this Deal Card.'),
        evidence: resolutionEvidence,
        warnings,
        missingInformation: ['A readable Comps & Valuation projection for this Deal Card'],
      };
    }

    const projected = factsFromView(lane, subject, view);
    return {
      status: projected.facts.outcome === 'valuation_returned' ? 'SUCCEEDED' : 'NEEDS_INPUT',
      subjectResolution,
      canonicalSubject,
      facts: projected.facts,
      evidence: [...resolutionEvidence, ...projected.evidence],
      warnings,
      missingInformation: projected.missingInformation,
    };
  },
};
